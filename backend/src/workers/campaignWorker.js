const whatsappService = require("../services/whatsappService");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const contactRepository = require("../repositories/contactRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");
const { resolveTemplateText, resolveTemplateSendTarget, sanitizeVariableValue } = require("../utils/templateHelper");

const process = async (job) => {
  const contact = await contactRepository.findByPhone(job.phone);

  // 1. Exclude opted-out / inactive contacts before execution
  if (contact && contact.is_active === false) {
    logger.warn(`Campaign send skipped for ${job.phone}: Contact has opted out or is inactive.`);
    const optOutErr = new Error("Contact has opted out or is inactive.");
    optOutErr.category = "opt_out";
    throw optOutErr;
  }

  const contactName = contact?.name && contact.name !== job.phone ? contact.name : "Valued Customer";

  // 2. Personalize text message body
  let personalizedMessage = job.message || "";
  if (personalizedMessage) {
    personalizedMessage = personalizedMessage
      .replace(/\{\{(name|contact_name|customer_name|recipient_name|1)\}\}/gi, contactName)
      .replace(/\{\{(phone|contact_phone|mobile|number)\}\}/gi, job.phone);
  }

  // 3. Personalize template params array safely
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

  const personalizedParams = paramArray.map((p) => {
    if (typeof p === "string") {
      const cleanP = p.trim();
      const lowerP = cleanP.toLowerCase();
      if (lowerP === "{{contact_name}}" || lowerP === "{{name}}" || lowerP === "{{1}}" || lowerP === "{{customer_name}}") {
        return contactName;
      }
      if (lowerP === "{{contact_phone}}" || lowerP === "{{phone}}") {
        return job.phone;
      }
      if (cleanP === "") return contactName;
      return sanitizeVariableValue(cleanP);
    }
    return p !== undefined && p !== null ? sanitizeVariableValue(p) : contactName;
  });

  let templateDisplayText = personalizedMessage;
  if (!templateDisplayText || templateDisplayText.startsWith("HX") || templateDisplayText.startsWith("[Template:")) {
    templateDisplayText = await resolveTemplateText(job.template_name, personalizedParams, job.message || "");
  }

  const provider = await whatsappService.getActiveProvider();
  const { sendName: apiTemplateName, language } = await resolveTemplateSendTarget(job.template_name, provider);

  if (job.type === "template" && provider === "meta" && (!apiTemplateName || String(apiTemplateName).startsWith("HX"))) {
    throw new Error(
      `Invalid Meta template configuration for "${job.template_name}". Use an approved Meta template name synced in the templates table.`
    );
  }

  const sendOptions = { language };

  try {
    let result;
    if (job.type === "template") {
      result = personalizedParams.length > 0
        ? await whatsappService.sendTemplateWithParams(
            job.phone,
            apiTemplateName,
            personalizedParams,
            job.media_url,
            templateDisplayText,
            sendOptions
          )
        : await whatsappService.sendTemplateMessage(
            job.phone,
            apiTemplateName,
            job.media_url,
            templateDisplayText,
            sendOptions
          );
    } else {
      result = await whatsappService.sendTextMessage(job.phone, personalizedMessage, job.media_url);
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
      media_url: job.media_url || "",
      timestamp: new Date().toISOString(),
    });

    try {
      await conversationRepository.upsert({
        phone: job.phone,
        contact_name: contactName,
        last_message: savedMsg.text,
        last_direction: "outgoing",
        last_status: "sent",
        last_timestamp: savedMsg.timestamp,
      });
    } catch (convErr) {
      logger.warn("Conversation upsert warning after message creation:", { error: convErr.message });
    }

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
        mediaUrl: job.media_url || "",
        timestamp: savedMsg.timestamp,
      });
    }

    return { messageSid, savedMsg };
  } catch (err) {
    logger.error(`Campaign job send failed for phone ${job.phone}:`, { error: err.message, category: err.category });
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
        media_url: job.media_url || "",
        timestamp: failTime,
      });

      try {
        await conversationRepository.upsert({
          phone: job.phone,
          contact_name: contactName,
          last_message: failText,
          last_direction: "outgoing",
          last_status: "failed",
          last_timestamp: failTime,
        });
      } catch (convErr) {}

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
