const jobRepository = require("../repositories/jobRepository");
const settingsRepository = require("../repositories/settingsRepository");
const campaignRepository = require("../repositories/campaignRepository");
const campaignWorker = require("./campaignWorker");
const retryWorker = require("./retryWorker");
const statusSyncWorker = require("./statusSyncWorker");
const templateApprovalWorker = require("./templateApprovalWorker");
const campaignProgress = require("../services/campaignProgress");
const retentionService = require("../services/retentionService");
const { getSafeguards, quietHoursOptions, hasQuietHoursOverride } = require("../services/sendingPolicy");
const { quietHoursEnd } = require("../utils/quietHours");
const logger = require("../utils/logger");

let isRunning = false;
let workerLoopTimeout = null;
let inFlight = null; // the job being sent right now, if any
const timers = [];

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

// Deletes messages past the retention period (Settings, default 60 days).
const purgeOldMessages = async () => {
  try {
    await retentionService.purgeOldMessages();
  } catch (err) {
    logger.error("Message retention run failed", { error: err.message });
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

// The queue only carries outgoing messages (campaigns and auto-replies).
// Anything else fails visibly instead of being guessed at or marked done.
const runJob = async (job) => {
  if (job.type === "template" || job.type === "text") {
    await campaignWorker.process(job);
    return;
  }
  const err = new Error(`Unsupported job type "${job.type}"`);
  err.category = "invalid_job";
  throw err;
};

// Runs one pulled job end to end. Returns true if it was sent.
const handleJob = async (job) => {
  if (!(await admitCampaignJob(job))) return false;

  logger.info(`Processing job ${job.id} (type: ${job.type}) for phone ${job.phone}`);
  try {
    await runJob(job);
  } catch (err) {
    const result = await retryWorker.scheduleRetry(job, err);
    if (result.type === "permanent_fail") {
      await campaignProgress.refreshCampaignProgress(job.campaign_id, { phone: job.phone, status: "failed" }).catch((e) =>
        logger.error("Could not refresh campaign progress", { error: e.message })
      );
    }
    return false;
  }

  // Sent. Bookkeeping errors are logged, never retried: a retry would send the
  // message again.
  try {
    await jobRepository.update(job.id, { status: "completed" });
  } catch (err) {
    logger.error(`Job ${job.id} was sent but couldn't be marked completed`, { error: err.message });
  }
  try {
    await campaignProgress.refreshCampaignProgress(job.campaign_id, { phone: job.phone, status: "sent" });
  } catch (err) {
    logger.error("Could not refresh campaign progress", { error: err.message });
  }
  return true;
};

const start = () => {
  if (isRunning) return;
  isRunning = true;
  logger.info("Specialized Queue worker dispatcher started");
  processQueue();

  cleanupOldJobs();
  purgeOldMessages();
  recoverStaleJobs();
  timers.push(setInterval(cleanupOldJobs, 12 * 60 * 60 * 1000));
  timers.push(setInterval(purgeOldMessages, 12 * 60 * 60 * 1000));
  timers.push(setInterval(recoverStaleJobs, 5 * 60 * 1000));
  statusSyncWorker.start();
  templateApprovalWorker.start();
};

// Stops taking new jobs. Resolves once the job being sent (if any) is done,
// so a shutdown never cuts a send off half-way.
const stop = () => {
  isRunning = false;
  if (workerLoopTimeout) {
    clearTimeout(workerLoopTimeout);
  }
  timers.splice(0).forEach(clearInterval);
  statusSyncWorker.stop();
  templateApprovalWorker.stop();
  logger.info("Specialized Queue worker dispatcher stopped");
  return inFlight || Promise.resolve();
};

const processQueue = async () => {
  if (!isRunning) return;

  try {
    const job = await jobRepository.pullPendingJob();

    if (!job) {
      workerLoopTimeout = setTimeout(processQueue, 1000);
      return;
    }

    inFlight = handleJob(job);
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (!isRunning) return;

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

module.exports = { start, stop, processBatch, admitCampaignJob, handleJob };
