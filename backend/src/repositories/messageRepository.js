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

  // Has an agent or auto-reply (not a campaign) written to this phone since?
  async hasNonCampaignOutgoingSince(phone, sinceISO) {
    const { data, error } = await supabase
      .from("messages")
      .select("id")
      .eq("phone", phone)
      .eq("direction", "outgoing")
      .is("campaign_id", null)
      .gte("timestamp", sinceISO)
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length);
  },

  // Messages recorded for a campaign, and how many failed for reasons that
  // signal a problem with the list or the content. Meta's per-person
  // marketing holds and opt-out skips are excluded: they aren't quality issues.
  async countCampaignHealth(campaignId) {
    const { count: total } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .neq("error_category", "opt_out");

    const { count: failed } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["failed", "undelivered"])
      .not("error_category", "in", "(marketing_limit,opt_out)");

    return { total: total || 0, failed: failed || 0 };
  },

  // Approximate unique people reached with templates (business-initiated
  // conversations) since a time. Uses the SQL function from migration 005,
  // falling back to paging through rows.
  async countBusinessInitiatedSince(sinceISO) {
    const { data, error } = await supabase.rpc("count_business_initiated_since", { since: sinceISO });
    if (!error && data !== null && data !== undefined) return Number(data) || 0;

    const phones = new Set();
    for (let page = 0; page < 50; page++) {
      const { data: rows, error: pageError } = await supabase
        .from("messages")
        .select("phone")
        .eq("direction", "outgoing")
        .eq("type", "template")
        .gte("timestamp", sinceISO)
        .not("status", "in", "(failed,undelivered)")
        .range(page * 1000, page * 1000 + 999);
      if (pageError) throw pageError;
      (rows || []).forEach((r) => phones.add(r.phone));
      if (!rows || rows.length < 1000) break;
    }
    return phones.size;
  },

  // Which of these phones received a (non-failed) campaign message since a time.
  async recentlyContactedPhones(phones, sinceISO) {
    const list = Array.from(new Set(phones || []));
    const result = new Set();
    if (list.length === 0) return result;

    for (let i = 0; i < list.length; i += 300) {
      const chunk = list.slice(i, i + 300);
      const { data, error } = await supabase.rpc("recently_contacted_phones", { phone_list: chunk, since: sinceISO });
      if (!error) {
        (data || []).forEach((r) => result.add(r.phone));
        continue;
      }
      const { data: rows, error: fallbackError } = await supabase
        .from("messages")
        .select("phone")
        .in("phone", chunk)
        .eq("direction", "outgoing")
        .not("campaign_id", "is", null)
        .gte("timestamp", sinceISO)
        .not("status", "in", "(failed,undelivered)")
        .limit(5000);
      if (fallbackError) throw fallbackError;
      (rows || []).forEach((r) => result.add(r.phone));
    }
    return result;
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
