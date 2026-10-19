const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { getLive, getReady, getHealth } = require("../../controllers/healthController");
const env = require("../../config/env");

const queueWorker = require("../../workers/queueWorker");

router.get("/health", getHealth);
router.get("/ready", getReady);
router.get("/live", getLive);

// Public (unauthenticated) queue-drain endpoint for serverless cron. It must be
// protected by a shared secret so it cannot be triggered by anyone on the
// internet. Supply CRON_SECRET and send it as `Authorization: Bearer <secret>`
// or the `x-cron-secret` header.
const cronAuthorized = (req) => {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers["x-cron-secret"] ||
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(String(header || ""), "utf8");
  const b = Buffer.from(String(secret), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

router.get("/jobs/process-queue", async (req, res) => {
  if (!env.CRON_SECRET) {
    return res.status(503).json({ error: "Queue processing endpoint is not configured (set CRON_SECRET)." });
  }
  if (!cronAuthorized(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const processed = await queueWorker.processBatch(50);
    res.json({ success: true, processed, timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
