const jobRepository = require("../repositories/jobRepository");
const settingsRepository = require("../repositories/settingsRepository");
const campaignRepository = require("../repositories/campaignRepository");
const messageRepository = require("../repositories/messageRepository");
const campaignWorker = require("./campaignWorker");
const webhookWorker = require("./webhookWorker");
const templateSyncWorker = require("./templateSyncWorker");
const mediaWorker = require("./mediaWorker");
const analyticsWorker = require("./analyticsWorker");
const retryWorker = require("./retryWorker");
const { getIo } = require("../socket");
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

const start = (socketIo) => {
  if (isRunning) return;
  isRunning = true;
  logger.info("Specialized Queue worker dispatcher started");
  processQueue();

  cleanupOldJobs();
  recoverStaleJobs();
  setInterval(cleanupOldJobs, 12 * 60 * 60 * 1000);
  setInterval(recoverStaleJobs, 5 * 60 * 1000);
};

const stop = () => {
  isRunning = false;
  if (workerLoopTimeout) {
    clearTimeout(workerLoopTimeout);
  }
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

    logger.info(`Processing job ${job.id} (type: ${job.type}) for phone ${job.phone}`);

    try {
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

      await jobRepository.update(job.id, { status: "completed" });
      await updateCampaignProgress(job.campaign_id, job.phone, "sent");

    } catch (err) {
      await retryWorker.scheduleRetry(job, err);
    }

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

const updateCampaignProgress = async (campaignId, phone, status) => {
  if (!campaignId) return;

  const io = getIo();
  try {
    const counts = await jobRepository.getCountsByCampaignId(campaignId);
    const { deliveredCount, readCount } = await messageRepository.countDeliveredAndRead(campaignId);

    // Recipients that failed pre-flight validation (invalid phone, opt-out)
    // never became job rows, so account for them explicitly instead of letting
    // the job-only counts overwrite and hide them.
    let campaign = null;
    try { campaign = await campaignRepository.findById(campaignId); } catch (e) { /* ignore */ }
    const totalContacts = (campaign && campaign.total_contacts) || counts.total;
    const preflightFailed = Math.max(0, totalContacts - counts.total);

    const processedJobs = counts.completed + counts.failed;
    const totalFailed = counts.failed + preflightFailed;
    const allProcessed = counts.total === 0 ? true : processedJobs >= counts.total;
    const campaignStatus = allProcessed ? "completed" : "running";

    await campaignRepository.update(campaignId, {
      sent_count: counts.completed,
      failed_count: totalFailed,
      delivered_count: deliveredCount,
      read_count: readCount,
      status: campaignStatus,
    });

    const processedIncludingPreflight = processedJobs + preflightFailed;
    const progressPercent = totalContacts > 0 ? Math.round((processedIncludingPreflight / totalContacts) * 100) : 0;

    if (io) {
      if (allProcessed) {
        io.emit("campaign_complete", {
          campaignId,
          sentCount: counts.completed,
          failedCount: totalFailed,
          total: totalContacts,
        });
      } else {
        io.emit("campaign_progress", {
          campaignId,
          phone,
          status,
          progress: progressPercent,
        });
      }

      io.emit("campaign_update", {
        campaignId,
        sentCount: counts.completed,
        failedCount: totalFailed,
        deliveredCount: deliveredCount,
        readCount: readCount,
        status: campaignStatus,
      });
    }

  } catch (err) {
    logger.error("Failed to update campaign progress counts:", { campaignId, error: err });
  }
};

const processBatch = async (maxJobs = 50) => {
  let processedCount = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = await jobRepository.pullPendingJob();
    if (!job) break;

    try {
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
        await campaignWorker.process(job);
      }

      await jobRepository.update(job.id, { status: "completed" });
      await updateCampaignProgress(job.campaign_id, job.phone, "sent");
      processedCount++;
    } catch (err) {
      await retryWorker.scheduleRetry(job, err);
    }
  }
  return processedCount;
};

module.exports = { start, stop, processBatch };
