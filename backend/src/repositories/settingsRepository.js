const supabase = require("../config/supabase");
const secretBox = require("../utils/secretBox");
const logger = require("../utils/logger");

// Settings that hold credentials. They are encrypted before saving and
// decrypted when read, so every reader gets the plain value.
const SECRET_KEYS = new Set(["twilioAuthToken", "twilioApiSecret", "metaAccessToken", "accessToken"]);

const decode = (row) => {
  if (!row || !SECRET_KEYS.has(row.key)) return row;
  try {
    return { ...row, value: secretBox.decrypt(row.value) };
  } catch (err) {
    logger.error(`The saved ${row.key} can't be decrypted (the encryption key changed?). Re-enter it in Settings.`);
    return { ...row, value: "" };
  }
};

const encode = (key, value) => (SECRET_KEYS.has(key) ? secretBox.encrypt(value) : value);

const settingsRepository = {
  async findAll() {
    const { data, error } = await supabase
      .from("settings")
      .select("*");
    if (error) throw error;
    return (data || []).map(decode);
  },

  async findByKey(key) {
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return decode(data);
  },

  async upsert(key, value) {
    const { data, error } = await supabase
      .from("settings")
      .upsert({ key, value: encode(key, value) })
      .select()
      .single();
    if (error) throw error;
    return decode(data);
  },

  // Encrypts credentials saved before encryption existed. Safe to run often.
  async encryptStoredSecrets() {
    if (!secretBox.canEncrypt()) return 0;
    const { data, error } = await supabase.from("settings").select("key, value").in("key", [...SECRET_KEYS]);
    if (error) throw error;
    let count = 0;
    for (const row of data || []) {
      if (typeof row.value === "string" && row.value && !secretBox.isEncrypted(row.value)) {
        await this.upsert(row.key, row.value);
        count++;
      }
    }
    return count;
  },
};

module.exports = settingsRepository;
