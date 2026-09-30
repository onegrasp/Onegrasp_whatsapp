const express = require("express");
const router = express.Router();
const supabase = require("../utils/supabase");
const logger = require("../utils/logger");

// Get all conversations (efficiently using Conversations table in Supabase)
router.get("/conversations", async (req, res) => {
  try {
    const { search } = req.query;

    const { data: conversations, error } = await supabase
      .from("conversations")
      .select(`
        phone,
        contact_name,
        last_message,
        last_direction,
        last_status,
        last_timestamp,
        unread_count,
        contacts (
          name,
          label,
          is_important
        )
      `)
      .order("last_timestamp", { ascending: false });

    if (error) throw error;

    // Map and enrich contact details using single joined query (KI-004)
    const enriched = (conversations || []).map((c) => {
      const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
      return {
        phone: c.phone,
        name: contact?.name || c.contact_name || c.phone,
        label: contact?.label || "none",
        isImportant: contact?.is_important || false,
        lastMessage: c.last_message,
        lastDirection: c.last_direction,
        lastStatus: c.last_status,
        lastTimestamp: c.last_timestamp,
        unreadCount: c.unread_count,
      };
    });

    // Filter by search
    let result = enriched;
    if (search) {
      result = enriched.filter(
        (c) =>
          c.name?.toLowerCase().includes(search.toLowerCase()) ||
          c.phone?.includes(search)
      );
    }

    res.json(result);
  } catch (err) {
    logger.error("Failed to load conversations from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Get messages for a specific phone number & reset unread count
router.get("/messages/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const fromOffset = (parseInt(page) - 1) * parseInt(limit);
    const toLimit = fromOffset + parseInt(limit) - 1;

    // Reset unread count in conversations table
    await supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("phone", phone);

    // Fetch messages paginated
    const { data: messages, count: total, error } = await supabase
      .from("messages")
      .select("*", { count: "exact" })
      .eq("phone", phone)
      .order("timestamp", { ascending: true })
      .range(fromOffset, toLimit);

    if (error) throw error;

    // Map database properties to match React interface keys
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

    res.json({ messages: mapped, total: total || 0 });
  } catch (err) {
    logger.error("Failed to load messages for phone in Supabase:", { phone, error: err });
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const { count: totalContacts } = await supabase
      .from("contacts")
      .select("*", { count: "exact", head: true });

    const { count: totalMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true });

    const { count: sentMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .eq("direction", "outgoing");

    const { count: deliveredMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "delivered");

    const { count: readMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "read");

    const { count: failedMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .in("status", ["failed", "undelivered"]);

    const { count: incomingMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("direction", "incoming");

    res.json({
      totalContacts: totalContacts || 0,
      totalMessages: totalMessages || 0,
      sentMessages: sentMessages || 0,
      deliveredMessages: deliveredMessages || 0,
      readMessages: readMessages || 0,
      failedMessages: failedMessages || 0,
      incomingMessages: incomingMessages || 0,
    });
  } catch (err) {
    logger.error("Failed to fetch dashboard statistics from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Get all settings (including extended Twilio configuration parameters)
router.get("/settings", async (req, res) => {
  try {
    const { data: settings, error } = await supabase.from("settings").select("*");
    if (error) throw error;

    const settingsObj = {};
    (settings || []).forEach((s) => {
      settingsObj[s.key] = s.value;
    });

    // Load defaults if not present
    if (settingsObj.autoReplyEnabled === undefined) settingsObj.autoReplyEnabled = false;
    if (settingsObj.autoReplyMessage === undefined) {
      settingsObj.autoReplyMessage = "Thank you for reaching out! We have received your message and will get back shortly.";
    }
    if (settingsObj.twilioMode === undefined) settingsObj.twilioMode = "sandbox";
    if (settingsObj.twilioAccountSid === undefined) settingsObj.twilioAccountSid = "";
    if (settingsObj.twilioAuthToken === undefined) settingsObj.twilioAuthToken = "";
    if (settingsObj.twilioWhatsappNumber === undefined) settingsObj.twilioWhatsappNumber = "";
    if (settingsObj.twilioMessagingServiceSid === undefined) settingsObj.twilioMessagingServiceSid = "";
    if (settingsObj.validateWebhookSignature === undefined) settingsObj.validateWebhookSignature = false;
    if (settingsObj.sendingRate === undefined) settingsObj.sendingRate = 2; // Default 2 msg/sec

    // Mask twilioAuthToken for security (KI-001)
    if (settingsObj.twilioAuthToken) {
      settingsObj.twilioAuthToken = "••••••••";
    }

    res.json(settingsObj);
  } catch (err) {
    logger.error("Failed to load settings from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// Update settings
router.post("/settings", async (req, res) => {
  try {
    const fields = [
      "autoReplyEnabled",
      "autoReplyMessage",
      "twilioMode",
      "twilioAccountSid",
      "twilioAuthToken",
      "twilioWhatsappNumber",
      "twilioMessagingServiceSid",
      "validateWebhookSignature",
      "sendingRate",
    ];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        let val = req.body[field];
        if (field === "sendingRate") val = Number(val) || 2;
        
        // Security check: do not overwrite twilioAuthToken with masked value
        if (field === "twilioAuthToken" && val === "••••••••") {
          continue;
        }

        await supabase
          .from("settings")
          .upsert({ key: field, value: val });
      }
    }

    // Invalidate Twilio client configuration cache (KI-006)
    try {
      const { clearTwilioConfigCache } = require("../services/whatsappService");
      clearTwilioConfigCache();
    } catch (cacheErr) {
      logger.warn("Failed to clear Twilio client cache:", { error: cacheErr });
    }

    logger.info("Configuration settings updated successfully in Supabase.");
    res.json({ message: "Settings updated successfully" });
  } catch (err) {
    logger.error("Failed to update settings in Supabase:", { error: err });
    res.status(500).json({ error: "Failed to update settings" });
  }
});

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "whatsapp-bulk-messaging-system-secret-key-12345";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Auth login route
router.post("/auth/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token });
  }
  res.status(401).json({ error: "Invalid password" });
});

module.exports = router;
