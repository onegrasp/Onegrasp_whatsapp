const logger = require("../../utils/logger");

const process = async (job) => {
  logger.info("analyticsWorker processing an analytics job", { jobId: job.id });
  return { success: true };
};

module.exports = { process };
