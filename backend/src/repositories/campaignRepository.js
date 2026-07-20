const supabase = require("../config/supabase");

const campaignRepository = {
  async create(campaignData) {
    const { data, error } = await supabase
      .from("campaigns")
      .insert([campaignData])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, campaignData) {
    const { data, error } = await supabase
      .from("campaigns")
      .update(campaignData)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findAll(limit = 50) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async findById(id) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
};

module.exports = campaignRepository;
