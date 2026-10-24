const { getContext } = require("../context/requestContext");

const logHistory = [];
const MAX_LOG_HISTORY = 500;

// Logs are kept in memory, shown on the Logs page and shipped to the host's
// log stream, so personal data and secrets are removed before anything is
// written: secrets are hidden, phone numbers keep only their last 4 digits and
// message text is replaced by its length.
const MASK = "••••••••";
const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|signature|credential/i;
const PHONE_KEY = /^(phone|phones|to|from|recipient|recipients|phonenumber|wa_id|recipient_id)$/i;
const TEXT_KEY = /^(body|text|caption|bodytext|message_text|messagebody|personalizedmessage|resolvedmsgtext)$/i;
const PHONE_IN_TEXT = /(whatsapp:)?\+\d{8,15}/g;

const maskPhone = (value) => {
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 6 ? `+•••${digits.slice(-4)}` : MASK;
};

const redact = (value, key = "", depth = 0) => {
  if (value === null || value === undefined) return value;
  if (key && SECRET_KEY.test(key)) return MASK;
  if (key && PHONE_KEY.test(key)) {
    return Array.isArray(value) ? `[${value.length} numbers]` : typeof value === "object" ? MASK : maskPhone(value);
  }
  if (key && TEXT_KEY.test(key) && typeof value === "string") return `[${value.length} chars]`;
  if (typeof value === "string") return value.replace(PHONE_IN_TEXT, (m) => maskPhone(m));
  if (typeof value !== "object" || depth > 5) return value;
  if (value instanceof Error) return { message: redact(value.message), stack: value.stack, code: value.code };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, "", depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redact(v, k, depth + 1);
  return out;
};

const formatLog = (level, message, context = {}) => {
  const reqContext = getContext();
  const logObj = {
    timestamp: new Date().toISOString(),
    level,
    message: redact(String(message)),
    requestId: reqContext.requestId || null,
    correlationId: reqContext.correlationId || null,
    userId: reqContext.userId || null,
    ...redact(context || {}),
  };

  logHistory.push(logObj);
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }

  return JSON.stringify(logObj);
};

const logger = {
  info: (message, context) => {
    console.log(formatLog("INFO", message, context));
  },
  warn: (message, context) => {
    console.warn(formatLog("WARN", message, context));
  },
  error: (message, context) => {
    console.error(formatLog("ERROR", message, context));
  },
  debug: (message, context) => {
    if (process.env.NODE_ENV !== "production") {
      console.log(formatLog("DEBUG", message, context));
    }
  },
  getHistory: () => {
    return logHistory;
  }
};

module.exports = logger;
