const supabase = require("../config/supabase");
const logger = require("../utils/logger");

// messages.media_url is added by migrations/004_message_media.sql. Until that
// migration runs, inserting the column fails, so retry without it rather than
// losing the message record.
let mediaColumnMissing = false;
const isMissingMediaColumn = (error) => Boolean(error && /media_url/.test(error.message || ""));

const insertMessage = (payload) =>
  supabase.from("messages").insert([payload]).select().single();

const messageRepository = {
  async create(messageData) {
    const payload = { ...messageData };
    if (!payload.media_url || mediaColumnMissing) delete payload.media_url;

    let { data, error } = await insertMessage(payload);
    if (error && payload.media_url && isMissingMediaColumn(error)) {
      mediaColumnMissing = true;
      logger.warn("messages.media_url column is missing — run backend/migrations/004_message_media.sql so sent images appear in Chats.");
      delete payload.media_url;
      ({ data, error } = await insertMessage(payload));
    }
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

  // Returns the most recent messages for a phone, oldest first within the page.
  // Page 1 is the latest `limit` messages, so long conversations always show
  // what was sent last instead of stopping at the first 50 ever sent.
  async findByPhone(phone, page = 1, limit = 50) {
    const fromOffset = (parseInt(page) - 1) * parseInt(limit);
    const toLimit = fromOffset + parseInt(limit) - 1;

    const { data, count, error } = await supabase
      .from("messages")
      .select("*", { count: "exact" })
      .eq("phone", phone)
      .order("timestamp", { ascending: false })
      .range(fromOffset, toLimit);

    if (error) throw error;
    return { data: (data || []).reverse(), count };
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
