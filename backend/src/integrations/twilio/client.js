const twilio = require("twilio");
const supabase = require("../../config/supabase");
const env = require("../../config/env");
const logger = require("../../utils/logger");

let cachedConfig = null;
let cacheExpiry = 0;
const CACHE_TTL = 30000;

let currentClient = null;
let currentSid = null;
let currentToken = null;
let currentApiKey = null;

const getTwilioConfig = async (forceRefresh = false) => {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiry && !forceRefresh) {
    return cachedConfig;
  }

  try {
    const { data: settings, error } = await supabase.from("settings").select("*");
    if (error) throw error;

    const config = {};
    (settings || []).forEach((s) => {
      config[s.key] = s.value;
    });

    let rawAccountSid = config.twilioAccountSid || env.TWILIO_ACCOUNT_SID;
    let rawAuthToken = config.twilioAuthToken || env.TWILIO_AUTH_TOKEN;
    let rawApiKey = config.twilioApiKey || env.TWILIO_API_KEY;
    let rawApiSecret = config.twilioApiSecret || env.TWILIO_API_SECRET;
    const mode = config.twilioMode || env.TWILIO_MODE || "sandbox";

    let accountSid = null;
    let apiKey = null;
    let apiSecret = rawApiSecret;
    let authToken = null;

    // Detect AC... account SID vs SK... API Key
    if (rawAccountSid && rawAccountSid.startsWith("AC")) {
      accountSid = rawAccountSid;
    }
    if (rawAccountSid && rawAccountSid.startsWith("SK")) {
      apiKey = rawAccountSid;
    }

    if (rawAuthToken && rawAuthToken.startsWith("AC")) {
      accountSid = rawAuthToken;
    } else if (rawAuthToken && rawAuthToken.startsWith("SK")) {
      apiKey = rawAuthToken;
    } else if (rawAuthToken) {
      authToken = rawAuthToken;
    }

    if (rawApiKey && rawApiKey.startsWith("SK")) {
      apiKey = rawApiKey;
    }

    let fromPhone = "whatsapp:+14155238886";
    let messagingServiceSid = null;

    if (mode === "sandbox") {
      fromPhone = "whatsapp:+14155238886";
    } else {
      fromPhone = config.twilioWhatsappNumber || env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
      messagingServiceSid = config.twilioMessagingServiceSid || env.TWILIO_MESSAGING_SERVICE_SID || null;

      if (fromPhone && !fromPhone.startsWith("whatsapp:")) {
        fromPhone = `whatsapp:${fromPhone}`;
      }
    }

    cachedConfig = {
      accountSid,
      authToken,
      apiKey,
      apiSecret,
      fromPhone,
      messagingServiceSid,
      mode,
    };
    cacheExpiry = now + CACHE_TTL;
    return cachedConfig;
  } catch (err) {
    logger.error("Error loading Twilio settings from Supabase. Falling back to env.", { error: err });
    let fromPhone = env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
    if (fromPhone && !fromPhone.startsWith("whatsapp:")) {
      fromPhone = `whatsapp:${fromPhone}`;
    }

    let accountSid = env.TWILIO_ACCOUNT_SID && env.TWILIO_ACCOUNT_SID.startsWith("AC") ? env.TWILIO_ACCOUNT_SID : null;
    let apiKey = env.TWILIO_API_KEY || (env.TWILIO_ACCOUNT_SID && env.TWILIO_ACCOUNT_SID.startsWith("SK") ? env.TWILIO_ACCOUNT_SID : null);

    return {
      accountSid,
      authToken: env.TWILIO_AUTH_TOKEN,
      apiKey,
      apiSecret: env.TWILIO_API_SECRET,
      fromPhone,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || null,
      mode: env.TWILIO_MODE || "sandbox",
    };
  }
};

const getTwilioClient = async (forceRefresh = false) => {
  const config = await getTwilioConfig(forceRefresh);

  const useApiKey = !!(config.apiKey && config.apiSecret);

  if (useApiKey) {
    if (!config.accountSid) {
      throw new Error("When using an API Key (SK...), your main Twilio Account SID (AC...) must also be provided in TWILIO_ACCOUNT_SID.");
    }
    if (!currentClient || forceRefresh || currentApiKey !== config.apiKey || currentSid !== config.accountSid) {
      currentClient = twilio(config.apiKey, config.apiSecret, { accountSid: config.accountSid });
      currentApiKey = config.apiKey;
      currentSid = config.accountSid;
    }
  } else {
    if (!config.accountSid || !config.authToken) {
      throw new Error("Twilio Account SID (AC...) and Auth Token must be configured.");
    }
    if (!currentClient || forceRefresh || currentSid !== config.accountSid || currentToken !== config.authToken) {
      currentClient = twilio(config.accountSid, config.authToken);
      currentSid = config.accountSid;
      currentToken = config.authToken;
    }
  }

  return currentClient;
};

const clearTwilioConfigCache = () => {
  cachedConfig = null;
  cacheExpiry = 0;
  currentClient = null;
  currentSid = null;
  currentToken = null;
  currentApiKey = null;
};

module.exports = {
  getTwilioConfig,
  getTwilioClient,
  clearTwilioConfigCache,
};
