const whatsappService = require("../services/whatsappService");
const supabase = require("../utils/supabase");
const logger = require("../utils/logger");
const { validateAndFormatE164 } = require("../utils/phone");

// Send bulk messages (Queued campaign execution via Supabase jobs table)
const sendBulk = async (req, res) => {
  const io = req.app.get("io");
  const { phones, templateName, message, campaignName, type = "template", params = [], mediaUrl = "", scheduledAt = null } = req.body;

  if (!phones || phones.length === 0) {
    return res.status(400).json({ error: "No phone numbers provided" });
  }

  if (type === "template" && !templateName) {
    return res.status(400).json({ error: "Template name/content is required" });
  }

  if (type === "text" && !message) {
    return res.status(400).json({ error: "Message text is required" });
  }

  // Sanitize message body: strip null bytes, limit length (KI-018)
  let sanitizedMessage = message || "";
  if (type === "text" && message) {
    sanitizedMessage = message.replace(/\0/g, "");
    if (sanitizedMessage.length > 4096) {
      sanitizedMessage = sanitizedMessage.substring(0, 4096);
    }
  }

  // Create campaign record
  const { data: campaign, error: campError } = await supabase
    .from("campaigns")
    .insert([
      {
        name: campaignName || `Campaign ${new Date().toLocaleDateString()}`,
        message: sanitizedMessage || "",
        template_name: templateName || "",
        type,
        total_contacts: phones.length,
        status: scheduledAt && new Date(scheduledAt) > new Date() ? "scheduled" : "running",
      },
    ])
    .select()
    .single();

  if (campError) {
    logger.error("Failed to create campaign in Supabase:", { error: campError });
    return res.status(500).json({ error: "Failed to create campaign database entry" });
  }

  logger.info(`Starting campaign: ${campaign.name} (${campaign.id}) for ${phones.length} contacts.`);

  // 1. Fetch contact details (names & active status) for dynamic variable replacement & exclusion
  const cleanDbPhones = phones.map(p => {
    const { formatted } = validateAndFormatE164(p);
    return formatted;
  }).filter(Boolean);

  const contactMap = {};
  if (cleanDbPhones.length > 0) {
    try {
      const { data: contactsList } = await supabase
        .from("contacts")
        .select("phone, name, is_active")
        .in("phone", cleanDbPhones);
      
      (contactsList || []).forEach((c) => {
        if (c.phone) {
          contactMap[c.phone] = c;
        }
      });
    } catch (dbErr) {
      logger.error("Failed to query contact names for bulk sending variable resolution:", { error: dbErr });
    }
  }

  let immediateFailures = 0;
  const jobsToInsert = [];

  for (const rawPhone of phones) {
    const { isValid, formatted } = validateAndFormatE164(rawPhone);

    if (!isValid) {
      immediateFailures++;
      logger.warn(`Phone number validation failed during bulk import: ${rawPhone}`);

      // Log direct message failure
      const failText = message || `[Template: ${templateName}]`;
      const failTime = new Date().toISOString();

      await supabase
        .from("messages")
        .insert([
          {
            phone: rawPhone,
            text: failText,
            type: type === "template" ? "template" : "text",
            direction: "outgoing",
            status: "failed",
            error_details: "Invalid phone number format. Must be E.164 (e.g., +1234567890).",
            error_category: "invalid_phone",
            campaign_id: campaign.id,
            timestamp: failTime,
          },
        ]);

      // Update Conversation record
      await supabase.from("conversations").upsert({
        phone: rawPhone,
        contact_name: rawPhone,
        last_message: failText,
        last_direction: "outgoing",
        last_status: "failed",
        last_timestamp: failTime,
      });

      continue;
    }

    // Look up contact details
    const contact = contactMap[formatted];
    const contactName = contact?.name || "Customer";

    // Exclude deactivated/opted-out contacts (KI-012)
    if (contact && contact.is_active === false) {
      immediateFailures++;
      logger.warn(`Phone number campaign send skipped: contact is inactive/opted-out: ${formatted}`);

      const failText = message || `[Template: ${templateName}]`;
      const failTime = new Date().toISOString();

      await supabase
        .from("messages")
        .insert([
          {
            phone: formatted,
            text: failText,
            type: type === "template" ? "template" : "text",
            direction: "outgoing",
            status: "failed",
            error_details: "Contact has opted out or is inactive.",
            error_category: "opt_out",
            campaign_id: campaign.id,
            timestamp: failTime,
          },
        ]);

      await supabase.from("conversations").upsert({
        phone: formatted,
        contact_name: contactName,
        last_message: failText,
        last_direction: "outgoing",
        last_status: "failed",
        last_timestamp: failTime,
      });

      continue;
    }

    // Resolve dynamic params
    const resolvedParams = (params || []).map(p => {
      if (p === "{{contact_name}}") return contactName;
      if (p === "{{contact_phone}}") return formatted;
      return p;
    });

    // Resolve placeholders in free text message if applicable
    const resolvedMsgText = type === "text" && sanitizedMessage
      ? sanitizedMessage.replace(/\{\{contact_name\}\}/g, contactName).replace(/\{\{contact_phone\}\}/g, formatted)
      : (sanitizedMessage || "");

    // Prepare job for background runner
    jobsToInsert.push({
      campaign_id: campaign.id,
      phone: formatted,
      type,
      template_name: templateName,
      message: resolvedMsgText,
      params: resolvedParams,
      media_url: mediaUrl,
      status: "pending",
      run_at: scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString(),
    });
  }

  if (jobsToInsert.length > 0) {
    const { error: batchInsertError } = await supabase.from("jobs").insert(jobsToInsert);
    if (batchInsertError) {
      logger.error("Failed to insert jobs in Supabase:", { error: batchInsertError });
      return res.status(500).json({ error: "Failed to queue bulk campaign tasks" });
    }
    logger.info(`Queued ${jobsToInsert.length} sending tasks inside campaign ${campaign.id}`);
  }

  // If all numbers immediately failed, mark campaign as completed/failed
  if (immediateFailures === phones.length) {
    await supabase
      .from("campaigns")
      .update({
        status: "failed",
        failed_count: immediateFailures,
      })
      .eq("id", campaign.id);

    if (io) {
      io.emit("campaign_complete", {
        campaignId: campaign.id,
        sentCount: 0,
        failedCount: immediateFailures,
        total: phones.length,
      });
    }
  } else if (immediateFailures > 0) {
    await supabase
      .from("campaigns")
      .update({
        failed_count: immediateFailures,
      })
      .eq("id", campaign.id);
  }

  // Respond immediately with queue start confirmation
  res.json({
    message: "Campaign queued successfully",
    campaignId: campaign.id,
    total: phones.length,
    queued: jobsToInsert.length,
    failed: immediateFailures,
  });
};

// Send single message (Synchronous execution with E.164 verification & media attachment support)
const sendSingle = async (req, res) => {
  const io = req.app.get("io");
  const { phone, message, type = "text", templateName, params = [], mediaUrl = "" } = req.body;

  if (!phone || (!message && !templateName)) {
    return res.status(400).json({ error: "Phone and message/template are required" });
  }

  // 1. Phone Validation
  const { isValid, formatted } = validateAndFormatE164(phone);
  if (!isValid) {
    return res.status(400).json({
      error: `Invalid phone number format: '${phone}'. Must follow E.164 standard (e.g. +14155238886).`,
    });
  }

  try {
    let result;
    if (type === "template") {
      result = params.length > 0
        ? await whatsappService.sendTemplateWithParams(formatted, templateName, params, mediaUrl)
        : await whatsappService.sendTemplateMessage(formatted, templateName, mediaUrl);
    } else {
      result = await whatsappService.sendTextMessage(formatted, message, mediaUrl);
    }

    const messageSid = result?.messages?.[0]?.id || "";
    const { data: contact } = await supabase
      .from("contacts")
      .select("name")
      .eq("phone", formatted)
      .maybeSingle();

    const { data: savedMsg, error: insertError } = await supabase
      .from("messages")
      .insert([
        {
          phone: formatted,
          contact_name: contact?.name || "",
          text: message || `[Template: ${templateName}]`,
          type,
          direction: "outgoing",
          status: "sent",
          message_id: messageSid,
          template_name: templateName || "",
          timestamp: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    // Update Conversation summary
    await supabase.from("conversations").upsert({
      phone: formatted,
      contact_name: contact?.name || formatted,
      last_message: savedMsg.text,
      last_direction: "outgoing",
      last_status: "sent",
      last_timestamp: savedMsg.timestamp,
    });

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
        timestamp: savedMsg.timestamp,
      });
    }

    res.json({ message: "Message sent", data: savedMsg });
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

      const failText = message || `[Template: ${templateName}]`;
      const failTime = new Date().toISOString();

      const { data: savedMsg } = await supabase
        .from("messages")
        .insert([
          {
            phone: formatted,
            contact_name: contact?.name || "",
            text: failText,
            type,
            direction: "outgoing",
            status: "failed",
            template_name: templateName || "",
            error_details: errorMsg,
            error_category: errorCategory,
            timestamp: failTime,
          },
        ])
        .select()
        .single();

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
    const { data: templates, error } = await supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Keep compatibility format
    const mapped = (templates || []).map((t) => ({
      _id: t.id,
      name: t.name,
      contentSid: t.content_sid,
      body: t.body,
      type: t.type,
      buttons: t.buttons,
      listItems: t.list_items,
      variables: t.variables,
      createdAt: t.created_at,
    }));

    res.json({ data: mapped });
  } catch (err) {
    logger.error("Failed to fetch templates from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch templates" });
  }
};

module.exports = {
  sendBulk,
  sendSingle,
  getCampaigns,
  getTemplates,
  getCampaignMessages,
  validateAndFormatE164,
};
