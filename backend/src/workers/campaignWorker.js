const twilioService = require("../services/twilioService");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const contactRepository = require("../repositories/contactRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

const { resolveTemplateText } = require("../utils/templateHelper");

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

  // 2. Personalize template params array safely regardless of data type
  let rawParams = job.params;
  if (typeof rawParams === "string") {
    try {
      rawParams = JSON.parse(rawParams);
    } catch (e) {
      rawParams = [rawParams];
    }
  }
  if (!Array.isArray(rawParams) && typeof rawParams === "object" && rawParams !== null) {
    rawParams = Object.values(rawParams);
  }
  const paramArray = Array.isArray(rawParams) ? rawParams : [];

  const personalizedParams = paramArray.map((p, idx) => {
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

  let templateDisplayText = personalizedMessage;
  if (!templateDisplayText || templateDisplayText.startsWith("HX") || templateDisplayText.startsWith("[Template:")) {
    templateDisplayText = await resolveTemplateText(job.template_name, personalizedParams, `Hello ${contactName}`);
  }

  try {
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
      text: templateDisplayText,
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
  } catch (err) {
    logger.error(`Campaign job send failed for phone ${job.phone}:`, { error: err.message });
    const failTime = new Date().toISOString();
    const failText = personalizedMessage || `[Template: ${job.template_name}]`;

    try {
      const savedMsg = await messageRepository.create({
        phone: job.phone,
        contact_name: contactName,
        text: failText,
        type: job.type === "template" ? "template" : "text",
        direction: "outgoing",
        status: "failed",
        error_details: err.message || "Sending failed",
        error_category: err.category || "api_error",
        template_name: job.template_name || "",
        campaign_id: job.campaign_id,
        timestamp: failTime,
      });

      await conversationRepository.upsert({
        phone: job.phone,
        contact_name: contactName,
        last_message: failText,
        last_direction: "outgoing",
        last_status: "failed",
        last_timestamp: failTime,
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
          status: "failed",
          errorDetails: savedMsg.error_details,
          timestamp: savedMsg.timestamp,
        });
      }
    } catch (dbErr) {
      logger.error("Failed to record failed message in DB:", { error: dbErr });
    }

    throw err;
  }
};

module.exports = { process };
