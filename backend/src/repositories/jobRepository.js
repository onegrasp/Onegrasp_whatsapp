const supabase = require("../config/supabase");

const jobRepository = {
  async create(jobData) {
    const { data, error } = await supabase
      .from("jobs")
      .insert([jobData])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Inserts without reading the rows back (large batches exceed the 1,000-row page).
  async insertMany(jobsArray) {
    const { error } = await supabase.from("jobs").insert(jobsArray);
    if (error) throw error;
  },

  async createBatch(jobsArray) {
    const { data, error } = await supabase
      .from("jobs")
      .insert(jobsArray)
      .select();
    if (error) throw error;
    return data;
  },

  async update(id, jobData) {
    const { data, error } = await supabase
      .from("jobs")
      .update(jobData)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async pullPendingJob() {
    if (!supabase.isConfigured) return null;
    const { data, error } = await supabase.rpc("pull_pending_job");
    if (error) throw error;
    return data && data[0];
  },

  async cleanupOldJobs(thirtyDaysAgo) {
    if (!supabase.isConfigured) return 0;
    const { count, error } = await supabase
      .from("jobs")
      .delete({ count: "exact" })
      .in("status", ["completed", "failed"])
      .lt("updated_at", thirtyDaysAgo);
    if (error) throw error;
    return count;
  },

  async recoverStaleProcessingJobs(staleMinutes = 5) {
    if (!supabase.isConfigured) return 0;
    const cutoffTime = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("jobs")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("status", "processing")
      .lt("updated_at", cutoffTime)
      .select("id");
    if (error) throw error;
    return data ? data.length : 0;
  },

  // Moves a campaign's jobs between states (pause / resume / cancel).
  async setStatusForCampaign(campaignId, fromStatuses, toStatus, extra = {}) {
    const { data, error } = await supabase
      .from("jobs")
      .update({ status: toStatus, ...extra })
      .eq("campaign_id", campaignId)
      .in("status", fromStatuses)
      .select("id");
    if (error) throw error;
    return data ? data.length : 0;
  },

  // Earliest run time among a campaign's pending jobs (to tell running from scheduled).
  async nextRunAt(campaignId) {
    const { data, error } = await supabase
      .from("jobs")
      .select("run_at")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("run_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    return data && data[0] ? data[0].run_at : null;
  },

  // Someone opted out: drop their queued campaign messages.
  async cancelPendingForPhone(phone) {
    const { data, error } = await supabase
      .from("jobs")
      .update({ status: "cancelled", error: "Recipient opted out" })
      .eq("phone", phone)
      .not("campaign_id", "is", null)
      .in("status", ["pending", "paused"])
      .select("campaign_id");
    if (error) throw error;
    return data || [];
  },

  async hasPendingAutoReply(phone) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .eq("phone", phone)
      .is("campaign_id", null)
      .in("status", ["pending", "processing"])
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length);
  },

  async getCountsByCampaignId(campaignId) {
    const { data: rpcCounts, error: rpcErr } = await supabase.rpc("get_campaign_job_counts", {
      campaign_uuid: campaignId,
    });

    if (!rpcErr && rpcCounts) {
      const counts = { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, paused: 0, cancelled: 0 };
      rpcCounts.forEach((row) => {
        const count = parseInt(row.count, 10) || 0;
        counts.total += count;
        if (row.status in counts) counts[row.status] = count;
      });
      return counts;
    } else {
      const { count: total } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId);

      const { count: completed } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "completed");

      const { count: failed } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "failed");

      const { count: pending } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "pending");

      const { count: processing } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "processing");

      const { count: paused } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "paused");

      const { count: cancelled } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "cancelled");

      return {
        total: total || 0,
        completed: completed || 0,
        failed: failed || 0,
        pending: pending || 0,
        processing: processing || 0,
        paused: paused || 0,
        cancelled: cancelled || 0,
      };
    }
  }
};

module.exports = jobRepository;
