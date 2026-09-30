const express = require("express");
const router = express.Router();
const { getLive, getReady, getHealth } = require("../../controllers/healthController");

const queueWorker = require("../../workers/queueWorker");

router.get("/health", getHealth);
router.get("/ready", getReady);
router.get("/live", getLive);

router.get("/jobs/process-queue", async (req, res) => {
  try {
    const processed = await queueWorker.processBatch(50);
    res.json({ success: true, processed, timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
