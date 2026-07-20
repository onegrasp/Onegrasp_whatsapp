const logger = require("../../utils/logger");

const process = async (job) => {
  logger.info("templateSyncWorker processing a template sync job", { jobId: job.id });
  return { success: true };
};

module.exports = { process };
