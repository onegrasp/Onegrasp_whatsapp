const whatsappService = require("../services/whatsappService");
const supabase = require("../utils/supabase");
const logger = require("../utils/logger");
const { validateAndFormatE164 } = require("../utils/phone");
const { resolveTemplateText, validateTemplateParameters } = require("../utils/templateHelper");
const templateRepository = require("../repositories/templateRepository");
const messageRepository = require("../repositories/messageRepository");
const sendingPolicy = require("../services/sendingPolicy");
const { validateSendMessage } = require("../validators/message.validator");

const sendSingle = async (req, res) => {
  const io = req.app.get("io");
  const rawBody = req.body || {};
  const rawPhone = rawBody.phone || rawBody.to || rawBody.recipient || rawBody.phoneNumber;
  const rawMessage = rawBody.message || rawBody.text || rawBody.bodyText || "";
  const rawTemplateName = rawBody.templateName || rawBody.template_name || "";
  const rawMediaUrl = rawBody.mediaUrl || rawBody.media_url || rawBody.imageUrl || "";

  if (!rawPhone || (!rawMessage && !rawTemplateName && !rawMediaUrl)) {
    return res.status(400).json({ error: "Phone and a message, template or attachment are required" });
  }

  // Accepts the field aliases above, then validates types and sizes.
  let input;
  try {
    input = validateSendMessage({
      phone: String(rawPhone),
      message: rawMessage,
      type: rawBody.type || (rawTemplateName ? "template" : "text"),
      templateName: rawTemplateName,
      params: Array.isArray(rawBody.params) ? rawBody.params : (rawBody.parameters || []),
      mediaUrl: rawMediaUrl,
    });
  } catch (err) {
    const reason = Array.isArray(err.issues) && err.issues[0] ? err.issues[0].message : "Invalid message";
    return res.status(400).json({ error: reason });
  }
  const phone = input.phone;
  const message = input.message || "";
  const type = input.type;
  const templateName = input.templateName || "";
  const params = input.params;
  const mediaUrl = input.mediaUrl || "";

  // 1. Phone Validation
  const { isValid, formatted } = validateAndFormatE164(phone);
  if (!isValid) {
    return res.status(400).json({
      error: `Invalid phone number format: '${phone}'. Must follow E.164 standard (e.g. +14155238886).`,
    });
  }

  // 2. Opt-outs apply to every send path, not just campaigns.
  try {
    const blocked = await sendingPolicy.optOutBlockReason(formatted, { template: type === "template" });
    if (blocked) return res.status(409).json({ error: blocked, category: "opt_out" });
  } catch (err) {
    logger.error("Could not check opt-out status before sending", { error: err.message });
    return res.status(503).json({ error: "Couldn't check whether this contact opted out. Please try again." });
  }

  // 3. Safeguard: Pre-validate Template Parameters
  if (type === "template" && templateName) {
    try {
      let tpl = await templateRepository.findByName(templateName);
      if (!tpl) tpl = await templateRepository.findByContentSid(templateName);
      if (!tpl) tpl = await templateRepository.findById(templateName);

      if (tpl && tpl.body) {
        const valRes = validateTemplateParameters(tpl.body, params);
        if (!valRes.isValid) {
          logger.warn(`Template parameter validation failed for single send: ${valRes.error}`);
          return res.status(400).json({ error: valRes.error });
        }
      }
    } catch (valErr) {
      logger.warn("Could not pre-validate template parameters:", { error: valErr.message });
    }
  }

  let result;
  try {
    if (type === "template") {
      result = params.length > 0
        ? await whatsappService.sendTemplateWithParams(formatted, templateName, params, mediaUrl, message)
        : await whatsappService.sendTemplateMessage(formatted, templateName, mediaUrl, message);
    } else {
      result = await whatsappService.sendTextMessage(formatted, message, mediaUrl);
    }
  } catch (err) {
    return recordSendFailure({ err, io, res, phone, formatted, message, type, templateName, mediaUrl });
  }

  // The message is out. Nothing below may report it as failed (it would be
  // sent again), so errors are logged and the record falls back to what we know.
  let contactName = "Customer";
  try {
    const { data: contact } = await supabase
      .from("contacts")
      .select("name")
      .eq("phone", formatted)
      .maybeSingle();
    if (contact?.name) contactName = contact.name;
  } catch (e) {}

  let templateDisplayText = message;
  const needsTemplateText = type === "template" ||
    (templateDisplayText && (templateDisplayText.startsWith("HX") || templateDisplayText.startsWith("[Template:")));
  if (needsTemplateText) {
    try {
      templateDisplayText = await resolveTemplateText(templateName, params, message || "");
    } catch (e) {
      templateDisplayText = message || `[Template: ${templateName}]`;
    }
  }

  const messageSid = result?.messages?.[0]?.id || result?.sid || null;
  const timestamp = new Date().toISOString();

  const record = {
    phone: formatted,
    contact_name: contactName,
    text: templateDisplayText || "",
    type,
    direction: "outgoing",
    status: "sent",
    message_id: messageSid,
    template_name: templateName || "",
    media_url: mediaUrl || "",
    timestamp,
  };
  let savedMsg = { id: `msg_${Date.now()}`, ...record };

  try {
    savedMsg = await messageRepository.create(record);

    try {
      await supabase.from("conversations").upsert({
        phone: formatted,
        contact_name: contactName || formatted,
        last_message: savedMsg.text || (mediaUrl ? "Image" : ""),
        last_direction: "outgoing",
        last_status: "sent",
        last_timestamp: timestamp,
      });
    } catch (convErr) {}
  } catch (dbErr) {
    logger.warn("Message was sent but couldn't be saved:", { error: dbErr.message });
  }

  if (io) {
    io.emit("new_message", {
      _id: savedMsg.id || `msg_${Date.now()}`,
      phone: savedMsg.phone,
      contactName: savedMsg.contact_name || contactName,
      text: savedMsg.text,
      type: savedMsg.type,
      direction: savedMsg.direction,
      status: savedMsg.status,
      messageId: savedMsg.message_id || messageSid || "",
      mediaUrl: mediaUrl || "",
      timestamp: savedMsg.timestamp,
    });
  }

  return res.json({ message: "Message sent", data: savedMsg });
};

// The provider refused the message: record it as failed in the chat.
const recordSendFailure = async ({ err, io, res, phone, formatted, message, type, templateName, mediaUrl }) => {
  logger.error("Failed to send single WhatsApp message:", { phone, error: err });
  // Provider errors carry a mapped, user-facing reason (and a category);
  // anything else is internal and gets a plain message.
  const errorMsg = err.category ? err.message || String(err) : "The message couldn't be sent. Please try again.";
  const errorCategory = err.category || "other";

  try {
    const { data: contact } = await supabase
      .from("contacts")
      .select("name")
      .eq("phone", formatted)
      .maybeSingle();

    const failText = message || (templateName ? `[Template: ${templateName}]` : "");
    const failTime = new Date().toISOString();

    const savedMsg = await messageRepository.create({
      phone: formatted,
      contact_name: contact?.name || "",
      text: failText,
      type,
      direction: "outgoing",
      status: "failed",
      template_name: templateName || "",
      error_details: errorMsg,
      error_category: errorCategory,
      media_url: mediaUrl || "",
      timestamp: failTime,
    }).catch(() => null);

    // Update Conversation failure summary
    await supabase.from("conversations").upsert({
      phone: formatted,
      contact_name: contact?.name || formatted,
      last_message: failText,
      last_direction: "outgoing",
      last_status: "failed",
      last_timestamp: failTime,
    });

    if (io) {
      io.emit("new_message", {
        _id: savedMsg?.id,
        phone: formatted,
        contactName: contact?.name || "",
        text: failText,
        type: type,
        direction: "outgoing",
        status: "failed",
        messageId: "",
        mediaUrl: mediaUrl || "",
        errorDetails: errorMsg,
        timestamp: failTime,
      });
    }
  } catch (saveErr) {
    logger.error("Failed to save outbound failure message log:", { error: saveErr });
  }

  return res.status(500).json({ error: errorMsg, category: errorCategory });
};

module.exports = {
  sendSingle,
  validateAndFormatE164,
};
