const twilio = require("twilio");
const { getTwilioConfig } = require("./client");
const settingsRepository = require("../../repositories/settingsRepository");
const env = require("../../config/env");
const logger = require("../../utils/logger");

const MASKED_TOKEN = "••••••••";
const DIAGNOSIS_INTERVAL_MS = 10 * 60 * 1000;
let lastDiagnosisAt = 0;

// Twilio signs webhooks with the primary Auth Token of the sending account.
// Skip values that can never be that token: the UI's masked placeholder and
// SIDs pasted into the wrong field.
const isUsableToken = (value) =>
  typeof value === "string" && value.length > 0 && value !== MASKED_TOKEN && !/^(AC|SK)/.test(value);

// The token can live in the Settings table or in TWILIO_AUTH_TOKEN. Sending
// prefers Settings, but if Settings holds a stale or wrong value while the env
// var is correct (or vice versa), checking only one rejects every webhook.
const getCandidateTokens = async () => {
  const tokens = [];
  const add = (source, value) => {
    if (isUsableToken(value) && !tokens.some((t) => t.value === value)) {
      tokens.push({ source, value });
    }
  };
  try {
    const row = await settingsRepository.findByKey("twilioAuthToken");
    add("settings", row?.value);
  } catch (e) {
    // Settings unavailable — fall through to env.
  }
  add("env", env.TWILIO_AUTH_TOKEN);
  return tokens;
};

const firstHeaderValue = (value) => String(value || "").split(",")[0].trim();

// Twilio signs the exact URL it called. Behind Render/ngrok the scheme and host
// we see can differ from the public ones, so try the forwarded values, the
// other scheme, and the configured public origin — always with the real path.
const getCandidateUrls = (req) => {
  const path = req.originalUrl;
  const proto = firstHeaderValue(req.headers["x-forwarded-proto"]) || req.protocol || "https";
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || req.headers.host;
  const urls = new Set();

  if (host) {
    urls.add(`${proto}://${host}${path}`);
    urls.add(`${proto === "https" ? "http" : "https"}://${host}${path}`);
  }
  for (const base of [process.env.PUBLIC_URL, env.STATUS_CALLBACK_URL]) {
    if (!base) continue;
    try {
      urls.add(`${new URL(base).origin}${path}`);
    } catch (e) {
      // Ignore malformed configuration.
    }
  }
  return [...urls];
};

const logDiagnosis = async (req, tokens, urls) => {
  const now = Date.now();
  if (now - lastDiagnosisAt < DIAGNOSIS_INTERVAL_MS) return;
  lastDiagnosisAt = now;

  let configuredSid = null;
  try {
    configuredSid = (await getTwilioConfig()).accountSid;
  } catch (e) {
    // Ignore — diagnosis is best effort.
  }
  const webhookSid = (req.body && req.body.AccountSid) || null;

  let hint;
  if (tokens.length === 0) {
    hint = "No Twilio Auth Token is configured. Set TWILIO_AUTH_TOKEN (or the Auth Token in Settings) to the primary Auth Token of the sending account.";
  } else if (webhookSid && configuredSid && webhookSid !== configuredSid) {
    hint = `Webhook came from account ${webhookSid} but the app is configured for ${configuredSid}. Use the Auth Token of ${webhookSid}.`;
  } else if (tokens.every((t) => t.value.length !== 32)) {
    hint = "The configured token is not 32 characters — it looks like an API Key secret, which cannot verify webhooks. Use the account's primary Auth Token.";
  } else {
    hint = `The configured Auth Token does not match account ${webhookSid || configuredSid || "(unknown)"}. Copy the primary Auth Token from Twilio Console → Account → API keys & tokens.`;
  }

  logger.error(`Twilio webhook rejected: ${hint}`, {
    webhookAccountSid: webhookSid,
    configuredAccountSid: configuredSid,
    tokenSources: tokens.map((t) => `${t.source} (${t.value.length} chars)`),
    urlsTried: urls,
  });
};

/**
 * Verifies the X-Twilio-Signature header. Validation is on by default and is
 * skipped only when the `validateWebhookSignature` setting is explicitly false.
 * Any error fails closed.
 */
const verifySignature = async (req) => {
  try {
    try {
      const row = await settingsRepository.findByKey("validateWebhookSignature");
      if (row && (row.value === false || row.value === "false")) {
        return true;
      }
    } catch (e) {
      // Could not read the setting — keep the secure default (validate).
    }

    const signature = req.headers["x-twilio-signature"];
    if (!signature) {
      logger.warn("Twilio webhook rejected: missing X-Twilio-Signature header.");
      return false;
    }

    const tokens = await getCandidateTokens();
    const urls = getCandidateUrls(req);
    const params = req.body || {};

    const valid = tokens.some((t) => urls.some((url) => twilio.validateRequest(t.value, signature, url, params)));
    if (!valid) {
      logger.error("Twilio Signature Validation FAILED!", { url: urls[0] });
      await logDiagnosis(req, tokens, urls);
    }
    return valid;
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
