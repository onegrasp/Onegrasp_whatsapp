const jobRepository = require("../repositories/jobRepository");
const messageRepository = require("../repositories/messageRepository");
const campaignRepository = require("../repositories/campaignRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

const HELD_STATUSES = new Set(["paused", "cancelled"]);

/**
 * Recomputes a campaign's counts and status from its jobs and messages, saves
 * them, and pushes live updates. A paused or cancelled campaign keeps that
 * status; otherwise it is "completed" once no jobs are left to run.
 */
const refreshCampaignProgress = async (campaignId, { phone = null, status = null } = {}) => {
  if (!campaignId) return null;

  try {
    const counts = await jobRepository.getCountsByCampaignId(campaignId);
    const { deliveredCount, readCount } = await messageRepository.countDeliveredAndRead(campaignId);

    let campaign = null;
    try {
      campaign = await campaignRepository.findById(campaignId);
    } catch (e) {
      // Counts can still be saved without the campaign row.
    }

    // Recipients that failed pre-flight checks (invalid number, opted out)
    // never became jobs, so account for them explicitly.
    // With no jobs left (cleaned up after 30 days) this can't be worked out,
    // and the stored total is kept instead.
    const totalContacts = (campaign && campaign.total_contacts) || counts.total;
    const preflightFailed = counts.total > 0 ? Math.max(0, totalContacts - counts.total) : 0;
    const processedJobs = counts.completed + counts.failed;
    const totalFailed = counts.failed + preflightFailed;
    const remaining = counts.pending + counts.processing + (counts.paused || 0);

    let campaignStatus;
    if (campaign && HELD_STATUSES.has(campaign.status)) {
      campaignStatus = campaign.status;
    } else if (remaining === 0) {
      campaignStatus = "completed";
    } else if (campaign && campaign.status === "scheduled" && processedJobs === 0) {
      campaignStatus = "scheduled";
    } else {
      campaignStatus = "running";
    }

    // Totals only ever grow. Old jobs (after 30 days) and messages (after the
    // retention period) are deleted, so recomputing an old campaign — e.g. on
    // a late read receipt — must not wipe what it achieved.
    const keep = (fresh, stored) => Math.max(fresh || 0, stored || 0);
    await campaignRepository.update(campaignId, {
      sent_count: keep(counts.completed, campaign?.sent_count),
      failed_count: keep(totalFailed, campaign?.failed_count),
      delivered_count: keep(deliveredCount, campaign?.delivered_count),
      read_count: keep(readCount, campaign?.read_count),
      status: campaignStatus,
    });

    const io = getIo();
    if (io) {
      const done = processedJobs + preflightFailed + (counts.cancelled || 0);
      if (campaignStatus === "completed") {
        io.emit("campaign_complete", { campaignId, sentCount: counts.completed, failedCount: totalFailed, total: totalContacts });
      } else if (campaignStatus === "running") {
        io.emit("campaign_progress", {
          campaignId,
          phone,
          status,
          progress: totalContacts > 0 ? Math.round((done / totalContacts) * 100) : 0,
        });
      }
      io.emit("campaign_update", {
        campaignId,
        sentCount: counts.completed,
        failedCount: totalFailed,
        deliveredCount,
        readCount,
        status: campaignStatus,
        statusReason: campaign?.status_reason || "",
      });
    }

    return { ...counts, status: campaignStatus };
  } catch (err) {
    logger.error("Failed to update campaign progress counts:", { campaignId, error: err });
    return null;
  }
};

module.exports = { refreshCampaignProgress };
