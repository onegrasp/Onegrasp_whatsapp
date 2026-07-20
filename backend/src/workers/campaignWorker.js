const twilioService = require("../services/twilioService");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const contactRepository = require("../repositories/contactRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

const process = async (job) => {
  let result;
  if (job.type === "template") {
    result = job.params && job.params.length > 0
      ? await twilioService.sendTemplateWithParams(job.phone, job.template_name, job.params, job.media_url)
      : await twilioService.sendTemplateMessage(job.phone, job.template_name, job.media_url);
  } else {
    result = await twilioService.sendTextMessage(job.phone, job.message, job.media_url);
  }

  const messageSid = result?.messages?.[0]?.id || result?.sid || "";
  const contact = await contactRepository.findByPhone(job.phone);

  const savedMsg = await messageRepository.create({
    phone: job.phone,
    contact_name: contact?.name || "",
    text: job.message || `[Template: ${job.template_name}]`,
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
    contact_name: contact?.name || job.phone,
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
