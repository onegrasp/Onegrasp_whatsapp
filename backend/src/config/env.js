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
  JWT_SECRET: process.env.JWT_SECRET || "whatsapp-bulk-messaging-system-secret-key-12345",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin123",
  PROCESS_TYPE: process.env.PROCESS_TYPE || "all",
  NODE_ENV: process.env.NODE_ENV || "development",
};
