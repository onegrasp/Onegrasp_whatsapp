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
    const { data, error } = await supabase.rpc("pull_pending_job");
    if (error) throw error;
    return data && data[0];
  },

  async cleanupOldJobs(thirtyDaysAgo) {
    const { count, error } = await supabase
      .from("jobs")
      .delete({ count: "exact" })
      .in("status", ["completed", "failed"])
      .lt("updated_at", thirtyDaysAgo);
    if (error) throw error;
    return count;
  },

  async getCountsByCampaignId(campaignId) {
    const { data: rpcCounts, error: rpcErr } = await supabase.rpc("get_campaign_job_counts", {
      campaign_uuid: campaignId,
    });

    if (!rpcErr && rpcCounts) {
      let total = 0;
      let completed = 0;
      let failed = 0;
      let pending = 0;
      let processing = 0;

      rpcCounts.forEach((row) => {
        const count = parseInt(row.count, 10) || 0;
        total += count;
        if (row.status === "completed") completed = count;
        else if (row.status === "failed") failed = count;
        else if (row.status === "pending") pending = count;
        else if (row.status === "processing") processing = count;
      });

      return { total, completed, failed, pending, processing };
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

      return {
        total: total || 0,
        completed: completed || 0,
        failed: failed || 0,
        pending: pending || 0,
        processing: processing || 0
      };
    }
  }
};

module.exports = jobRepository;
