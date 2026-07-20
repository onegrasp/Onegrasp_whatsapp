const logger = require("../../utils/logger");

const process = async (job) => {
  logger.info("webhookWorker processing a webhook job", { jobId: job.id });
  return { success: true };
};

module.exports = { process };
