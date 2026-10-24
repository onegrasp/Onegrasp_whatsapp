const whatsappService = require("../services/whatsappService");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const contactRepository = require("../repositories/contactRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");
const { resolveTemplateText, resolveTemplateSendTarget, sanitizeVariableValue } = require("../utils/templateHelper");

const process = async (job) => {
  const contact = await contactRepository.findByPhone(job.phone);

  // 1. Exclude opted-out / inactive contacts before execution. Campaign
  //    messages also check the opt-out list, which covers numbers that aren't
  //    saved as contacts.
  const optedOut = (contact && contact.is_active === false) ||
    (job.campaign_id ? await contactRepository.isOptedOut(job.phone) : false);
  if (optedOut) {
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

  // A job can run again after a crash or a stale-job recovery. Never send the
  // same campaign to the same person twice.
  if (job.campaign_id && (await messageRepository.hasCampaignMessage(job.campaign_id, job.phone))) {
    logger.warn(`Campaign ${job.campaign_id} already reached ${job.phone}; not sending again.`);
    return { alreadySent: true };
  }

  let result;
  try {
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
  } catch (err) {
    logger.error(`Campaign job send failed for phone ${job.phone}:`, { error: err.message, category: err.category });
    // The retry worker decides whether this is final and records the failure
    // once. Pass along what the message would have said.
    err.displayText = personalizedMessage || templateDisplayText || `[Template: ${job.template_name}]`;
    err.contactName = contactName;
    throw err;
  }

  // The message is out. Nothing below may throw: the job would be retried and
  // the person would get the message again.
  const messageSid = result?.messages?.[0]?.id || result?.sid || null;
  const record = {
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
  };
  let savedMsg = record;
  try {
    savedMsg = await messageRepository.create(record);
  } catch (dbErr) {
    logger.error(`Message to ${job.phone} was sent but couldn't be saved`, { error: dbErr.message, messageSid });
  }

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
      _id: savedMsg.id || messageSid,
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
};

module.exports = { process };
