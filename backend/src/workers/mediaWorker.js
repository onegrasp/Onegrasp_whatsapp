const logger = require("../../utils/logger");

const process = async (job) => {
  logger.info("mediaWorker processing a media job", { jobId: job.id });
  return { success: true };
};

module.exports = { process };
