const crypto = require("crypto");

const isProduction = (process.env.NODE_ENV || "development") === "production";

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "TWILIO_ACCOUNT_SID",
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(`⚠️ Warning: Missing environment variables: ${missing.join(", ")}`);
}

if (!process.env.TWILIO_AUTH_TOKEN && (!process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET)) {
  console.warn("⚠️ Warning: Neither TWILIO_AUTH_TOKEN nor (TWILIO_API_KEY and TWILIO_API_SECRET) provided.");
}

// Secrets must never fall back to a value committed to source control. A shared
// default JWT secret lets anyone with the repo forge admin tokens, and a default
// admin password is an open door. In production we refuse to start without them;
// in development we generate an ephemeral JWT secret and disable login until an
// admin password is configured.
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (isProduction) {
    throw new Error("JWT_SECRET is required in production. Refusing to start with an insecure default.");
  }
  JWT_SECRET = crypto.randomBytes(48).toString("hex");
  console.warn("⚠️ JWT_SECRET not set — generated a random ephemeral secret for this process. Sessions will reset on restart. Set JWT_SECRET for stable sessions.");
}

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
if (!ADMIN_PASSWORD) {
  if (isProduction) {
    throw new Error("ADMIN_PASSWORD is required in production. Refusing to start without an admin password.");
  }
  console.warn("⚠️ ADMIN_PASSWORD not set — admin login is disabled until it is configured.");
}

module.exports = {
  PORT: parseInt(process.env.PORT || "5000", 10),
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
  TWILIO_API_KEY: process.env.TWILIO_API_KEY || "",
  TWILIO_API_SECRET: process.env.TWILIO_API_SECRET || "",
  TWILIO_WHATSAPP_NUMBER: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
  TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID || "",
  TWILIO_MODE: process.env.TWILIO_MODE || "sandbox",
  STATUS_CALLBACK_URL: process.env.STATUS_CALLBACK_URL || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "*",
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "",
  JWT_SECRET,
  ADMIN_PASSWORD,
  CRON_SECRET: process.env.CRON_SECRET || "",
  META_APP_SECRET: process.env.META_APP_SECRET || "",
  DEFAULT_COUNTRY_CODE: process.env.DEFAULT_COUNTRY_CODE || "91",
  IS_PRODUCTION: isProduction,
  PROCESS_TYPE: process.env.PROCESS_TYPE || "all",
  NODE_ENV: process.env.NODE_ENV || "development",
  // Meta WhatsApp Business (Cloud) API Settings
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || process.env.ACCESS_TOKEN || "",
  META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || "",
  META_WABA_ID: process.env.META_WABA_ID || process.env.WABA_ID || "",
  META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || "",
  META_API_VERSION: process.env.META_API_VERSION || "v18.0",
};
