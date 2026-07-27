const twilioService = require("../services/twilioService");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const contactRepository = require("../repositories/contactRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

const process = async (job) => {
  const contact = await contactRepository.findByPhone(job.phone);
  const contactName = contact?.name && contact.name !== job.phone ? contact.name : "Valued Customer";

  // 1. Personalize text message if placeholders like {{name}}, {{contact_name}}, {{1}}, etc. are present
  let personalizedMessage = job.message || "";
  if (personalizedMessage) {
    personalizedMessage = personalizedMessage
      .replace(/\{\{(name|contact_name|customer_name|recipient_name|1)\}\}/gi, contactName)
      .replace(/\{\{(phone|contact_phone|mobile|number)\}\}/gi, job.phone);
  }

  // 2. Personalize template params array if placeholders or empty values are passed
  let personalizedParams = [];
  if (job.params && Array.isArray(job.params)) {
    personalizedParams = job.params.map((p, idx) => {
      if (typeof p === "string") {
        const cleanP = p.trim().toLowerCase();
        if (!cleanP || cleanP === "{{contact_name}}" || cleanP === "{{name}}" || cleanP === "{{1}}" || cleanP === "{{customer_name}}") {
          return contactName;
        }
        if (cleanP === "{{contact_phone}}" || cleanP === "{{phone}}") {
          return job.phone;
        }
      }
      return p || contactName;
    });
  }

  let result;
  if (job.type === "template") {
    result = personalizedParams.length > 0
      ? await twilioService.sendTemplateWithParams(job.phone, job.template_name, personalizedParams, job.media_url)
      : await twilioService.sendTemplateMessage(job.phone, job.template_name, job.media_url);
  } else {
    result = await twilioService.sendTextMessage(job.phone, personalizedMessage, job.media_url);
  }

  const messageSid = result?.messages?.[0]?.id || result?.sid || "";

  const savedMsg = await messageRepository.create({
    phone: job.phone,
    contact_name: contactName,
    text: personalizedMessage || `[Template: ${job.template_name}]`,
    type: job.type === "template" ? "template" : "text",
    direction: "outgoing",
    status: "sent",
    message_id: messageSid,
    template_name: job.template_name || "",
    campaign_id: job.campaign_id,
    timestamp: new Date().toISOString(),
  });

  await conversationRepository.upsert({
    phone: job.phone,
    contact_name: contactName,
    last_message: savedMsg.text,
    last_direction: "outgoing",
    last_status: "sent",
    last_timestamp: savedMsg.timestamp,
  });

  const io = getIo();
  if (io) {
    io.emit("new_message", {
      _id: savedMsg.id,
      phone: savedMsg.phone,
      contactName: savedMsg.contact_name,
      text: savedMsg.text,
      type: savedMsg.type,
      direction: savedMsg.direction,
      status: savedMsg.status,
      messageId: savedMsg.message_id,
      templateName: savedMsg.template_name,
      campaignId: savedMsg.campaign_id,
      timestamp: savedMsg.timestamp,
    });
  }

  return { messageSid, savedMsg };
};

module.exports = { process };
