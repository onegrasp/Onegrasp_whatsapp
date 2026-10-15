const supabase = require("../config/supabase");

const messageRepository = {
  async create(messageData) {
    const { data, error } = await supabase
      .from("messages")
      .insert([messageData])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, messageData) {
    const { data, error } = await supabase
      .from("messages")
      .update(messageData)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateByMessageId(messageId, messageData) {
    const { data, error } = await supabase
      .from("messages")
      .update(messageData)
      .eq("message_id", messageId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByMessageId(messageId) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("message_id", messageId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByCampaignId(campaignId) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async findByPhone(phone, page = 1, limit = 50) {
    const fromOffset = (parseInt(page) - 1) * parseInt(limit);
    const toLimit = fromOffset + parseInt(limit) - 1;

    const { data, count, error } = await supabase
      .from("messages")
      .select("*", { count: "exact" })
      .eq("phone", phone)
      .order("timestamp", { ascending: true })
      .range(fromOffset, toLimit);

    if (error) throw error;
    return { data, count };
  },

  async getStats() {
    const { count: totalContacts } = await supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null);

    const { count: totalMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true });

    const { count: sentMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .eq("direction", "outgoing");

    const { count: deliveredMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "delivered");

    const { count: readMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "read");

    const { count: failedMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .in("status", ["failed", "undelivered"]);

    const { count: incomingMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("direction", "incoming");

    return {
      totalContacts: totalContacts || 0,
      totalMessages: totalMessages || 0,
      sentMessages: sentMessages || 0,
      deliveredMessages: deliveredMessages || 0,
      readMessages: readMessages || 0,
      failedMessages: failedMessages || 0,
      incomingMessages: incomingMessages || 0,
    };
  },

  async countDeliveredAndRead(campaignId) {
    const { count: deliveredMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["delivered", "read"]);

    const { count: readMessages } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "read");

    return {
      deliveredCount: deliveredMessages || 0,
      readCount: readMessages || 0,
    };
  }
};

module.exports = messageRepository;
