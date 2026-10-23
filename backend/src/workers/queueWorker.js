const jobRepository = require("../repositories/jobRepository");
const settingsRepository = require("../repositories/settingsRepository");
const campaignRepository = require("../repositories/campaignRepository");
const campaignWorker = require("./campaignWorker");
const webhookWorker = require("./webhookWorker");
const templateSyncWorker = require("./templateSyncWorker");
const mediaWorker = require("./mediaWorker");
const analyticsWorker = require("./analyticsWorker");
const retryWorker = require("./retryWorker");
const statusSyncWorker = require("./statusSyncWorker");
const { refreshCampaignProgress } = require("../services/campaignProgress");
const { getSafeguards, quietHoursOptions, hasQuietHoursOverride } = require("../services/sendingPolicy");
const { quietHoursEnd } = require("../utils/quietHours");
const logger = require("../utils/logger");

let isRunning = false;
let workerLoopTimeout = null;

const cleanupOldJobs = async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const count = await jobRepository.cleanupOldJobs(thirtyDaysAgo);
    if (count && count > 0) {
      logger.info(`Cleaned up ${count} historical jobs from database.`);
    }
  } catch (err) {
    logger.error("Failed to run jobs table cleanup policy:", { error: err });
  }
};

const recoverStaleJobs = async () => {
  try {
    const recovered = await jobRepository.recoverStaleProcessingJobs(5);
    if (recovered && recovered > 0) {
      logger.info(`Recovered ${recovered} orphaned 'processing' jobs back to 'pending'.`);
    }
  } catch (err) {
    logger.error("Failed to recover stale processing jobs:", { error: err.message });
  }
};

/**
 * Checks a pulled campaign job against the campaign's state and quiet hours.
 * Returns true if the job should be sent now; otherwise parks it and returns false.
 * Auto-replies and other non-campaign jobs always go through.
 */
const admitCampaignJob = async (job) => {
  if (!job.campaign_id) return true;

  const campaign = await campaignRepository.findById(job.campaign_id).catch(() => null);
  if (campaign && (campaign.status === "paused" || campaign.status === "cancelled")) {
    await jobRepository.update(job.id, { status: campaign.status });
    return false;
  }

  // An admin explicitly chose to send this campaign during quiet hours.
  if (hasQuietHoursOverride(campaign)) return true;

  const safeguards = await getSafeguards();
  const resumeAt = quietHoursEnd(new Date(), quietHoursOptions(safeguards));
  if (resumeAt) {
    await jobRepository.update(job.id, { status: "pending", run_at: resumeAt.toISOString() });
    logger.info(`Quiet hours: campaign message to ${job.phone} held until ${resumeAt.toISOString()}`);
    return false;
  }

  return true;
};

const runJob = async (job) => {
  if (job.type === "template" || job.type === "text") {
    await campaignWorker.process(job);
  } else if (job.type === "webhook_event") {
    await webhookWorker.process(job);
  } else if (job.type === "template_sync") {
    await templateSyncWorker.process(job);
  } else if (job.type === "media_upload") {
    await mediaWorker.process(job);
  } else if (job.type === "analytics_update") {
    await analyticsWorker.process(job);
  } else {
    logger.warn(`Unknown job type: ${job.type}. Defaulting to campaign processing.`);
    await campaignWorker.process(job);
  }
};

// Runs one pulled job end to end. Returns true if it was sent.
const handleJob = async (job) => {
  if (!(await admitCampaignJob(job))) return false;

  logger.info(`Processing job ${job.id} (type: ${job.type}) for phone ${job.phone}`);
  try {
    await runJob(job);
    await jobRepository.update(job.id, { status: "completed" });
    await refreshCampaignProgress(job.campaign_id, { phone: job.phone, status: "sent" });
    return true;
  } catch (err) {
    const result = await retryWorker.scheduleRetry(job, err);
    if (result.type === "permanent_fail") {
      await refreshCampaignProgress(job.campaign_id, { phone: job.phone, status: "failed" });
    }
    return false;
  }
};

const start = () => {
  if (isRunning) return;
  isRunning = true;
  logger.info("Specialized Queue worker dispatcher started");
  processQueue();

  cleanupOldJobs();
  recoverStaleJobs();
  setInterval(cleanupOldJobs, 12 * 60 * 60 * 1000);
  setInterval(recoverStaleJobs, 5 * 60 * 1000);
  statusSyncWorker.start();
};

const stop = () => {
  isRunning = false;
  if (workerLoopTimeout) {
    clearTimeout(workerLoopTimeout);
  }
  statusSyncWorker.stop();
  logger.info("Specialized Queue worker dispatcher stopped");
};

const processQueue = async () => {
  if (!isRunning) return;

  try {
    const job = await jobRepository.pullPendingJob();

    if (!job) {
      workerLoopTimeout = setTimeout(processQueue, 1000);
      return;
    }

    await handleJob(job);

    let sendingRate = 2;
    try {
      const rateSetting = await settingsRepository.findByKey("sendingRate");
      if (rateSetting && Number(rateSetting.value) > 0) {
        sendingRate = Number(rateSetting.value);
      }
    } catch (e) {
      // Ignore
    }

    const delayMs = Math.max(100, Math.round(1000 / sendingRate));
    workerLoopTimeout = setTimeout(processQueue, delayMs);
  } catch (globalErr) {
    logger.error("Error in specialized queue dispatcher process loop", { error: globalErr });
    workerLoopTimeout = setTimeout(processQueue, 2000);
  }
};

const processBatch = async (maxJobs = 50) => {
  let processedCount = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = await jobRepository.pullPendingJob();
    if (!job) break;
    if (await handleJob(job)) processedCount++;
  }
  return processedCount;
};

module.exports = { start, stop, processBatch, admitCampaignJob };
