const twilio = require("twilio");
const supabase = require("./supabase");
const logger = require("./logger");

const validateTwilioSignature = async (req, res, next) => {
  try {
    const { data: settings, error } = await supabase.from("settings").select("*");
    if (error) throw error;

    const config = {};
    (settings || []).forEach((s) => {
      config[s.key] = s.value;
    });

    const validateSignature = config.validateWebhookSignature === true;

    if (!validateSignature) {
      // Signature validation disabled, proceed
      return next();
    }

    const authToken = config.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      logger.warn("Twilio signature validation enabled but no Auth Token is configured. Bypassing validation.");
      return next();
    }

    const signature = req.headers["x-twilio-signature"];
    if (!signature) {
      logger.warn("Request rejected: missing X-Twilio-Signature header.");
      return res.status(403).send("Forbidden: Missing signature header");
    }

    // Handle forwarded headers from ngrok or reverse proxies
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;
    const params = req.body || {};

    const isValid = twilio.validateRequest(authToken, signature, fullUrl, params);

    if (!isValid) {
      logger.error("Twilio Signature Validation FAILED!", { url: fullUrl, signature });
      return res.status(403).send("Forbidden: Invalid Twilio signature");
    }

    logger.info("Twilio signature validated successfully.");
    next();
  } catch (err) {
    logger.error("Error during Twilio signature validation:", { error: err });
    res.status(500).send("Signature validation error");
  }
};

module.exports = { validateTwilioSignature };
