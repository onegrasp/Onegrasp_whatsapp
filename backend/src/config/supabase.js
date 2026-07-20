const { createClient } = require("@supabase/supabase-js");
const env = require("./env");

const supabaseUrl = (env.SUPABASE_URL && env.SUPABASE_URL.trim()) ? env.SUPABASE_URL.trim() : "https://placeholder.supabase.co";
const supabaseKey = (env.SUPABASE_KEY && env.SUPABASE_KEY.trim()) ? env.SUPABASE_KEY.trim() : "placeholder-key";

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
