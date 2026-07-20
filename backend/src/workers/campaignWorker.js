const twilioService = require("../services/twilioService");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const contactRepository = require("../repositories/contactRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

const process = async (job) => {
  const contact = await contactRepository.findByPhone(job.phone);
  const contactName = contact?.name || job.phone;

  // 1. Personalize text message if placeholders like {{name}} or {{phone}} are present
  let personalizedMessage = job.message || "";
  if (personalizedMessage) {
    personalizedMessage = personalizedMessage
      .replace(/\{\{name\}\}/gi, contactName)
      .replace(/\{\{contact_name\}\}/gi, contactName)
      .replace(/\{\{phone\}\}/gi, job.phone)
      .replace(/\{\{contact_phone\}\}/gi, job.phone);
  }

  // 2. Personalize template params array if placeholders like {{contact_name}} or {{name}} are passed
  let personalizedParams = [];
  if (job.params && Array.isArray(job.params)) {
    personalizedParams = job.params.map((p) => {
      if (typeof p === "string") {
        if (p === "{{contact_name}}" || p.toLowerCase() === "{{name}}") {
          return contactName;
        }
        if (p === "{{contact_phone}}" || p.toLowerCase() === "{{phone}}") {
          return job.phone;
        }
      }
      return p;
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
