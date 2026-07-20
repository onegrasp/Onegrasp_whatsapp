const supabase = require("../config/supabase");

const conversationRepository = {
  async findAll() {
    const { data, error } = await supabase
      .from("conversations")
      .select(`
        phone,
        contact_name,
        last_message,
        last_direction,
        last_status,
        last_timestamp,
        unread_count,
        contacts (
          name,
          label,
          is_important
        )
      `)
      .order("last_timestamp", { ascending: false });

    if (error) throw error;
    return data;
  },

  async findByPhone(phone) {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsert(conversationData) {
    const { data, error } = await supabase
      .from("conversations")
      .upsert(conversationData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async resetUnreadCount(phone) {
    const { data, error } = await supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("phone", phone)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateLastStatus(phone, status) {
    const { data, error } = await supabase
      .from("conversations")
      .update({ last_status: status })
      .eq("phone", phone)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }
};

module.exports = conversationRepository;
