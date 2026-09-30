const supabase = require("../config/supabase");

const settingsRepository = {
  async findAll() {
    const { data, error } = await supabase
      .from("settings")
      .select("*");
    if (error) throw error;
    return data;
  },

  async findByKey(key) {
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsert(key, value) {
    const { data, error } = await supabase
      .from("settings")
      .upsert({ key, value })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};

module.exports = settingsRepository;
