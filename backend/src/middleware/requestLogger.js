const logger = require("../utils/logger");

// Logs what happened to each change request or webhook — never bodies,
// headers or query strings, which carry phone numbers, message text and
// tokens.
const requestLogger = (req, res, next) => {
  if (req.method === "GET" && !req.originalUrl.includes("webhook")) return next();

  const started = Date.now();
  // Full path without the query string (routers rewrite req.path later).
  const path = req.originalUrl.split("?")[0];
  res.on("finish", () => {
    logger.info(`[HTTP ${req.method}] ${path} -> ${res.statusCode}`, {
      statusCode: res.statusCode,
      durationMs: Date.now() - started,
    });
  });
  next();
};

module.exports = requestLogger;
