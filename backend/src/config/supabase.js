const { createClient } = require("@supabase/supabase-js");
const env = require("./env");

const isConfigured = Boolean(
  env.SUPABASE_URL &&
  env.SUPABASE_URL.trim() &&
  !env.SUPABASE_URL.includes("placeholder") &&
  !env.SUPABASE_URL.includes("your_supabase") &&
  env.SUPABASE_URL.startsWith("http")
);
const supabaseUrl = isConfigured ? env.SUPABASE_URL.trim() : "https://xyzcompany.supabase.co";
const supabaseKey = (env.SUPABASE_KEY && env.SUPABASE_KEY.trim() && !env.SUPABASE_KEY.includes("your_supabase")) ? env.SUPABASE_KEY.trim() : "placeholder-key";

let supabase;
try {
  supabase = createClient(supabaseUrl, supabaseKey);
} catch (e) {
  supabase = createClient("https://xyzcompany.supabase.co", "placeholder-key");
}
supabase.isConfigured = isConfigured;

// With Row Level Security on (migration 003) only the service_role / secret
// key can read or write the tables; the anon / publishable key sees nothing.
const keyRole = (key) => {
  if (key.startsWith("sb_secret_")) return "service_role";
  if (key.startsWith("sb_publishable_")) return "anon";
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role || "unknown";
  } catch (e) {
    return "unknown";
  }
};
if (isConfigured && keyRole(supabaseKey) !== "service_role") {
  console.warn(
    `⚠️ Warning: SUPABASE_KEY is the "${keyRole(supabaseKey)}" key, not the service_role (secret) key. ` +
      "Once Row Level Security is enabled the backend won't be able to read or save data. " +
      "Use the service_role / secret key from Supabase → Project Settings → API Keys."
  );
}

module.exports = supabase;
