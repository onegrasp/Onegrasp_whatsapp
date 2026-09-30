const supabase = require("../../config/supabase");
const env = require("../../config/env");
const logger = require("../../utils/logger");

let cachedConfig = null;
let cacheExpiry = 0;
const CACHE_TTL = 30000;

const getMetaConfig = async (forceRefresh = false) => {
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

    const accessToken = config.metaAccessToken || config.accessToken || env.META_ACCESS_TOKEN;
    const phoneNumberId = config.metaPhoneNumberId || config.phoneNumberId || env.META_PHONE_NUMBER_ID;
    const wabaId = config.metaWabaId || config.wabaId || env.META_WABA_ID;
    const verifyToken = config.metaWebhookVerifyToken || config.webhookVerifyToken || env.META_WEBHOOK_VERIFY_TOKEN;
    const apiVersion = config.metaApiVersion || env.META_API_VERSION || "v18.0";

    cachedConfig = {
      accessToken,
      phoneNumberId,
      wabaId,
      verifyToken,
      apiVersion,
      isConfigured: Boolean(accessToken && phoneNumberId),
    };
    cacheExpiry = now + CACHE_TTL;
    return cachedConfig;
  } catch (err) {
    logger.warn("Error loading Meta settings from Supabase. Falling back to env.", { error: err.message });
    return {
      accessToken: env.META_ACCESS_TOKEN,
      phoneNumberId: env.META_PHONE_NUMBER_ID,
      wabaId: env.META_WABA_ID,
      verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
      apiVersion: env.META_API_VERSION || "v18.0",
      isConfigured: Boolean(env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID),
    };
  }
};

const clearMetaConfigCache = () => {
  cachedConfig = null;
  cacheExpiry = 0;
};

module.exports = {
  getMetaConfig,
  clearMetaConfigCache,
};
