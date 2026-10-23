const settingsRepository = require("../repositories/settingsRepository");
const { clearTwilioConfigCache } = require("../config/twilio");

const MASKED_TOKEN = "••••••••";

// Sending safeguards. Defaults are conservative; adjust in Settings.
const SAFEGUARD_DEFAULTS = {
  // Max unique people to start conversations with per 24h (your WhatsApp
  // messaging limit from WhatsApp Manager). 0 = not set (no check).
  dailyConversationLimit: 0,
  // Skip contacts who got a campaign message within this many days. 0 = off.
  campaignCooldownDays: 3,
  // Hold campaign messages overnight (recipient timezone).
  quietHoursEnabled: true,
  quietHoursStart: "21:00",
  quietHoursEnd: "09:00",
  quietHoursTimezone: "Asia/Kolkata",
  // Send the auto-reply at most once per contact in this many hours, and not
  // while an agent is already talking to them. 0 = no cooldown.
  autoReplyCooldownHours: 12,
};

const NUMERIC_FIELDS = new Set(["dailyConversationLimit", "campaignCooldownDays", "autoReplyCooldownHours"]);

const SAFEGUARD_CACHE_MS = 15000;
let safeguardCache = null;

const toNonNegativeNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const settingsService = {
  async getSettings() {
    const settings = await settingsRepository.findAll();
    const settingsObj = {};

    (settings || []).forEach((s) => {
      settingsObj[s.key] = s.value;
    });

    if (settingsObj.autoReplyEnabled === undefined) settingsObj.autoReplyEnabled = false;
    if (settingsObj.autoReplyMessage === undefined) {
      settingsObj.autoReplyMessage = "Thank you for reaching out! We have received your message and will get back shortly.";
    }
    if (settingsObj.twilioMode === undefined) settingsObj.twilioMode = "sandbox";
    if (settingsObj.twilioAccountSid === undefined) settingsObj.twilioAccountSid = "";
    if (settingsObj.twilioAuthToken === undefined) settingsObj.twilioAuthToken = "";
    if (settingsObj.twilioWhatsappNumber === undefined) settingsObj.twilioWhatsappNumber = "";
    if (settingsObj.twilioMessagingServiceSid === undefined) settingsObj.twilioMessagingServiceSid = "";
    if (settingsObj.validateWebhookSignature === undefined) settingsObj.validateWebhookSignature = true;
    if (settingsObj.sendingRate === undefined) settingsObj.sendingRate = 2;

    Object.entries(SAFEGUARD_DEFAULTS).forEach(([key, value]) => {
      if (settingsObj[key] === undefined) settingsObj[key] = value;
    });

    if (settingsObj.twilioAuthToken) {
      settingsObj.twilioAuthToken = MASKED_TOKEN;
    }

    return settingsObj;
  },

  // Safeguard values with defaults applied, for server-side use. Cached
  // briefly because the queue worker checks them before every campaign message.
  async getSafeguards() {
    if (safeguardCache && Date.now() < safeguardCache.expires) return safeguardCache.value;
    const rows = await settingsRepository.findAll().catch(() => []);
    const stored = {};
    (rows || []).forEach((s) => {
      stored[s.key] = s.value;
    });
    const result = { ...SAFEGUARD_DEFAULTS };
    Object.keys(SAFEGUARD_DEFAULTS).forEach((key) => {
      if (stored[key] === undefined) return;
      result[key] = NUMERIC_FIELDS.has(key) ? toNonNegativeNumber(stored[key], SAFEGUARD_DEFAULTS[key]) : stored[key];
    });
    result.quietHoursEnabled = result.quietHoursEnabled === true || result.quietHoursEnabled === "true";
    safeguardCache = { value: result, expires: Date.now() + SAFEGUARD_CACHE_MS };
    return result;
  },

  async updateSettings(body) {
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
      ...Object.keys(SAFEGUARD_DEFAULTS),
    ];

    for (const field of fields) {
      if (body[field] === undefined) continue;
      let val = body[field];

      if (field === "sendingRate") {
        // The worker can't go faster than 10/s; keep the value in range.
        const rate = Number(val);
        val = Number.isFinite(rate) && rate > 0 ? Math.min(rate, 10) : 2;
      }
      if (NUMERIC_FIELDS.has(field)) val = toNonNegativeNumber(val, SAFEGUARD_DEFAULTS[field]);
      if (field === "quietHoursEnabled") val = val === true || val === "true";
      if (field === "twilioAuthToken" && val === MASKED_TOKEN) continue;

      await settingsRepository.upsert(field, val);
    }

    clearTwilioConfigCache();
    safeguardCache = null;

    return { message: "Settings updated successfully" };
  },
};

module.exports = settingsService;
