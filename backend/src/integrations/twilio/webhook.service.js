const twilio = require("twilio");
const { getTwilioConfig } = require("./client");
const settingsRepository = require("../../repositories/settingsRepository");
const logger = require("../../utils/logger");

const verifySignature = async (req) => {
  try {
    // Validation is ON by default and is only skipped when explicitly disabled
    // via the `validateWebhookSignature` setting. Any error below fails closed.
    let validate = true;
    try {
      const row = await settingsRepository.findByKey("validateWebhookSignature");
      if (row && (row.value === false || row.value === "false")) {
        validate = false;
      }
    } catch (e) {
      // Could not read the setting — keep the secure default (validate).
    }

    if (!validate) {
      return true;
    }

    const config = await getTwilioConfig();
    const authToken = config.authToken;
    if (!authToken) {
      logger.error("Twilio signature validation is enabled but no Auth Token is configured. Rejecting request (fail closed).");
      return false;
    }

    const signature = req.headers["x-twilio-signature"];
    if (!signature) {
      logger.warn("Request rejected: missing X-Twilio-Signature header.");
      return false;
    }

    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;
    const params = req.body || {};

    const isValid = twilio.validateRequest(authToken, signature, fullUrl, params);
    if (!isValid) {
      logger.error("Twilio Signature Validation FAILED!", { url: fullUrl });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("Error during Twilio signature validation:", { error: err });
    return false;
  }
};

const stripWhatsappPrefix = (phone) => {
  if (!phone) return "";
  return phone.replace(/^whatsapp:/i, "").trim();
};

const normalizePayload = (body) => {
  return {
    from: stripWhatsappPrefix(body.From),
    to: stripWhatsappPrefix(body.To),
    messageSid: body.MessageSid,
    body: body.Body || "",
    profileName: body.ProfileName || "",
    numMedia: parseInt(body.NumMedia || "0", 10),
    mediaType0: body.MediaType0 || "",
    messageStatus: body.MessageStatus || null,
    errorCode: body.ErrorCode || null,
    errorMessage: body.ErrorMessage || null,
  };
};

module.exports = {
  verifySignature,
  normalizePayload,
};
