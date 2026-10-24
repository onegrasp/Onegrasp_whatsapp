const supabase = require("../config/supabase");
const logger = require("../utils/logger");
const { fetchAllRows } = require("./queryHelpers");

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

  // Every message of a campaign (campaigns can exceed Supabase's 1,000-row page).
  async findByCampaignId(campaignId) {
    return fetchAllRows(() =>
      supabase
        .from("messages")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    );
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

  // Dashboard counts. Delivery figures cover outgoing messages only: replies
  // are stored as "delivered" too and must not inflate the delivery rate.
  async getStats() {
    const count = async (build) => {
      const { count: n, error } = await build(supabase.from("messages").select("*", { count: "exact", head: true }));
      if (error) throw error;
      return n || 0;
    };
    const outgoing = (q) => q.eq("direction", "outgoing");

    const { count: totalContacts, error: contactsError } = await supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null);
    if (contactsError) throw contactsError;

    const [totalMessages, sentMessages, deliveredMessages, readMessages, failedMessages, incomingMessages] = await Promise.all([
      count((q) => q),
      count((q) => outgoing(q).eq("status", "sent")),
      count((q) => outgoing(q).eq("status", "delivered")),
      count((q) => outgoing(q).eq("status", "read")),
      count((q) => outgoing(q).in("status", ["failed", "undelivered"])),
      count((q) => q.eq("direction", "incoming")),
    ]);

    // Share of outgoing messages that reached the phone (delivered or read).
    const outgoingTotal = sentMessages + deliveredMessages + readMessages + failedMessages;
    const deliveryRate = outgoingTotal > 0 ? Math.round(((deliveredMessages + readMessages) / outgoingTotal) * 100) : 0;

    return {
      totalContacts: totalContacts || 0,
      totalMessages,
      sentMessages,
      deliveredMessages,
      readMessages,
      failedMessages,
      incomingMessages,
      deliveryRate,
    };
  },

  // Has an agent or auto-reply (not a campaign) written to this phone since?
  // Has this campaign already sent (or delivered, or had read) a message to
  // this number? Failed attempts don't count.
  async hasCampaignMessage(campaignId, phone) {
    const { data, error } = await supabase
      .from("messages")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("phone", phone)
      .eq("direction", "outgoing")
      .not("status", "in", "(failed,undelivered)")
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length);
  },

  // Has this number written to us after `sinceISO`?
  async hasIncomingSince(phone, sinceISO) {
    const clean = String(phone || "").replace(/^\+/, "");
    const { data, error } = await supabase
      .from("messages")
      .select("id")
      .in("phone", [`+${clean}`, clean])
      .eq("direction", "incoming")
      .gt("timestamp", sinceISO)
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length);
  },

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

  // Permanently deletes messages sent or received before `cutoffISO`.
  async deleteOlderThan(cutoffISO) {
    const { count, error } = await supabase.from("messages").delete({ count: "exact" }).lt("timestamp", cutoffISO);
    if (error) throw error;
    return count || 0;
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
