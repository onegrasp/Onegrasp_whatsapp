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

module.exports = supabase;
