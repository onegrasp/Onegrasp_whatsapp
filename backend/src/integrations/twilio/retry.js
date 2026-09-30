const logger = require("../../utils/logger");

const runWithRetry = async (fn, maxAttempts = 3, initialDelayMs = 1000) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isRetryable = err.code === 20429 || err.code === 63015 || err.status === 503 || err.status === 429;
      if (!isRetryable || attempt >= maxAttempts) {
        throw err;
      }
      const delay = initialDelayMs * Math.pow(2, attempt);
      logger.warn(`Twilio API transient error (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`, { error: err.message });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
};

module.exports = { runWithRetry };
