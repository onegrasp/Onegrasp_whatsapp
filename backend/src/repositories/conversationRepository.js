const supabase = require("../config/supabase");
const { sanitizeFilterValue } = require("./queryHelpers");

const conversationRepository = {
  // The most recent conversations, optionally filtered by name or number. The
  // search runs in the database so older conversations can still be found.
  async findAll({ search = "", limit = 500 } = {}) {
    let query = supabase
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
          is_important,
          is_active
        )
      `)
      .order("last_timestamp", { ascending: false })
      .limit(limit);

    const s = sanitizeFilterValue(search);
    if (s) query = query.or(`contact_name.ilike.%${s}%,phone.ilike.%${s}%`);

    const { data, error } = await query;
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
  },

  // Permanently deletes conversations with no activity since `cutoffISO`
  // (their messages are deleted by the same retention run).
  async deleteInactiveSince(cutoffISO) {
    const { count, error } = await supabase.from("conversations").delete({ count: "exact" }).lt("last_timestamp", cutoffISO);
    if (error) throw error;
    return count || 0;
  },
};

module.exports = conversationRepository;
