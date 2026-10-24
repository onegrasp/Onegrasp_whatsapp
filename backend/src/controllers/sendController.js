const whatsappService = require("../services/whatsappService");
const supabase = require("../utils/supabase");
const logger = require("../utils/logger");
const { validateAndFormatE164 } = require("../utils/phone");
const { resolveTemplateText, validateTemplateParameters } = require("../utils/templateHelper");
const templateRepository = require("../repositories/templateRepository");
const messageRepository = require("../repositories/messageRepository");
const sendingPolicy = require("../services/sendingPolicy");

const sendSingle = async (req, res) => {
  const io = req.app.get("io");
  const rawBody = req.body || {};
  const phone = rawBody.phone || rawBody.to || rawBody.recipient || rawBody.phoneNumber;
  const message = rawBody.message || rawBody.text || rawBody.bodyText || "";
  const type = rawBody.type || (rawBody.templateName || rawBody.template_name ? "template" : "text");
  const templateName = rawBody.templateName || rawBody.template_name || "";
  const params = Array.isArray(rawBody.params) ? rawBody.params : (rawBody.parameters || []);
  const mediaUrl = rawBody.mediaUrl || rawBody.media_url || rawBody.imageUrl || "";

  if (!phone || (!message && !templateName && !mediaUrl)) {
    return res.status(400).json({ error: "Phone and a message, template or attachment are required" });
  }

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

  try {
    let result;
    if (type === "template") {
      result = params.length > 0
        ? await whatsappService.sendTemplateWithParams(formatted, templateName, params, mediaUrl, message)
        : await whatsappService.sendTemplateMessage(formatted, templateName, mediaUrl, message);
    } else {
      result = await whatsappService.sendTextMessage(formatted, message, mediaUrl);
    }

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
      templateDisplayText = await resolveTemplateText(templateName, params, message || "");
    }

    const messageSid = result?.messages?.[0]?.id || result?.sid || `SM_${Date.now()}`;
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
      logger.warn("Database persistence skipped for message:", { error: dbErr.message });
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
        messageId: savedMsg.message_id || messageSid,
        mediaUrl: mediaUrl || "",
        timestamp: savedMsg.timestamp,
      });
    }

    return res.json({ message: "Message sent", data: savedMsg });
  } catch (err) {
    logger.error("Failed to send single WhatsApp message:", { phone, error: err });
    const errorMsg = err.message || String(err);
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

    res.status(500).json({ error: errorMsg, category: errorCategory });
  }
};

// Get campaign message logs
const getCampaignMessages = async (req, res) => {
  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("campaign_id", req.params.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Map database properties (like id -> _id, error_details -> errorDetails) to keep frontend compatibility
    const mapped = (messages || []).map((m) => ({
      _id: m.id,
      phone: m.phone,
      contactName: m.contact_name,
      text: m.text,
      type: m.type,
      direction: m.direction,
      status: m.status,
      messageId: m.message_id,
      errorDetails: m.error_details,
      timestamp: m.timestamp,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error("Failed to fetch campaign messages from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch campaign logs" });
  }
};

// Get campaigns
const getCampaigns = async (req, res) => {
  try {
    const { data: campaigns, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const mapped = (campaigns || []).map((c) => ({
      _id: c.id,
      name: c.name,
      message: c.message,
      templateName: c.template_name,
      type: c.type,
      totalContacts: c.total_contacts,
      sentCount: c.sent_count,
      deliveredCount: c.delivered_count,
      readCount: c.read_count,
      failedCount: c.failed_count,
      status: c.status,
      createdAt: c.created_at,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error("Failed to fetch campaigns from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
};

// Return templates from local Supabase database
const getTemplates = async (req, res) => {
  try {
    const { data: templates } = await supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false });

    const mapped = (templates || []).map((t) => ({
      _id: t.id,
      id: t.id,
      name: t.name,
      contentSid: t.content_sid,
      content_sid: t.content_sid,
      body: t.body || "",
      type: t.type || "text",
      category: t.category || "UTILITY",
      language: t.language || "en",
      status: t.status || "draft",
      buttons: t.buttons || [],
      listItems: t.list_items,
      variables: t.variables || [],
      createdAt: t.created_at,
    }));

    res.json({ data: mapped });
  } catch (err) {
    logger.error("Failed to fetch templates from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch templates", data: [] });
  }
};

module.exports = {
  sendSingle,
  getCampaigns,
  getTemplates,
  getCampaignMessages,
  validateAndFormatE164,
};
