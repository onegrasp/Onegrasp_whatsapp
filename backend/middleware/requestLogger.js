const logger = require("../utils/logger");

const requestLogger = (req, res, next) => {
  if (req.originalUrl.includes("webhook") || req.method !== "GET") {
    const cleanHeaders = { ...req.headers };
    delete cleanHeaders.authorization;
    delete cleanHeaders.cookie;
    delete cleanHeaders.set_cookie;

    const cleanBody = { ...req.body };
    if (cleanBody.password) cleanBody.password = "••••••••";
    if (cleanBody.twilioAuthToken) cleanBody.twilioAuthToken = "••••••••";

    logger.info(`[HTTP ${req.method}] ${req.originalUrl}`, {
      headers: cleanHeaders,
      body: cleanBody,
    });
  }
  next();
};

module.exports = requestLogger;
