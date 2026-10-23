const campaignRepository = require("../repositories/campaignRepository");
const jobRepository = require("../repositories/jobRepository");
const messageRepository = require("../repositories/messageRepository");
const { refreshCampaignProgress } = require("./campaignProgress");
const AppError = require("../errors/AppError");
const logger = require("../utils/logger");

const ACTIVE = ["running", "scheduled"];

const loadCampaign = async (id) => {
  const campaign = await campaignRepository.findById(id);
  if (!campaign) throw new AppError("Campaign not found", 404, "not_found");
  return campaign;
};

const campaignControl = {
  // Stops sending: queued jobs are parked as "paused". Messages already being
  // sent finish. Returns false when the campaign wasn't active (auto mode).
  async pause(id, reason = "Paused by admin", { auto = false } = {}) {
    const campaign = await loadCampaign(id);
    if (!ACTIVE.includes(campaign.status)) {
      if (auto) return false;
      throw new AppError(`This campaign is ${campaign.status} and can't be paused.`, 409, "invalid_state");
    }
    await jobRepository.setStatusForCampaign(id, ["pending"], "paused");
    await campaignRepository.updateWithReason(id, { status: "paused", status_reason: reason });
    await refreshCampaignProgress(id);
    return true;
  },

  async resume(id) {
    const campaign = await loadCampaign(id);
    if (campaign.status !== "paused") {
      throw new AppError(`This campaign is ${campaign.status}, not paused.`, 409, "invalid_state");
    }
    await jobRepository.setStatusForCampaign(id, ["paused"], "pending");
    const nextRun = await jobRepository.nextRunAt(id);
    const status = nextRun && new Date(nextRun) > new Date() ? "scheduled" : "running";
    await campaignRepository.updateWithReason(id, { status, status_reason: "" });
    await refreshCampaignProgress(id);
    return true;
  },

  async cancel(id) {
    const campaign = await loadCampaign(id);
    if (![...ACTIVE, "paused"].includes(campaign.status)) {
      throw new AppError(`This campaign is ${campaign.status} and can't be cancelled.`, 409, "invalid_state");
    }
    const cancelled = await jobRepository.setStatusForCampaign(id, ["pending", "paused"], "cancelled", {
      error: "Campaign cancelled",
    });
    await campaignRepository.updateWithReason(id, {
      status: "cancelled",
      status_reason: `Cancelled by admin. ${cancelled} unsent message${cancelled === 1 ? "" : "s"} dropped.`,
    });
    await refreshCampaignProgress(id);
    return { cancelled };
  },
};

// --- Automatic guard -------------------------------------------------------

// Failures that mean sending more will make things worse: stop at once.
const PAUSE_IMMEDIATELY = {
  account_restricted: "WhatsApp restricted the business account or sender. Check WhatsApp Manager before resuming.",
  policy_violation: "WhatsApp blocked a message for a policy violation. Review the template before resuming.",
  auth_error: "Twilio rejected the credentials. Fix the account settings before resuming.",
  rate_limit: "Hit WhatsApp's rate or daily conversation limit. Resume after the limit resets (up to 24 hours).",
};

const MIN_SAMPLE = 20;
const MAX_FAILURE_RATE = 0.3;

/**
 * Called after a campaign message fails (at send time or via a later status
 * update). Pauses the campaign when the failure points to an account problem,
 * or when too many messages are failing — the pattern that leads to a lower
 * quality rating and messaging limits.
 */
const onCampaignFailure = async (campaignId, category) => {
  if (!campaignId) return;
  try {
    let reason = PAUSE_IMMEDIATELY[category];

    if (!reason) {
      const { total, failed } = await messageRepository.countCampaignHealth(campaignId);
      if (total >= MIN_SAMPLE && failed / total >= MAX_FAILURE_RATE) {
        reason = `Paused automatically: ${Math.round((failed / total) * 100)}% of the first ${total} messages failed. Check the message log before resuming.`;
      }
    }
    if (!reason) return;

    const paused = await campaignControl.pause(campaignId, reason, { auto: true });
    if (paused) logger.error(`Campaign ${campaignId} paused automatically: ${reason}`);
  } catch (err) {
    logger.warn("Campaign guard check failed", { campaignId, error: err.message });
  }
};

module.exports = { campaignControl, onCampaignFailure };
