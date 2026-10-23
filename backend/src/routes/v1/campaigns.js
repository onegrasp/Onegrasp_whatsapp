const express = require("express");
const router = express.Router();
const { sendBulk, campaignPreflight } = require("../../controllers/bulkSendController");
const {
  getCampaigns,
  getCampaignMessages,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
} = require("../../controllers/campaignController");

// Every way of creating a campaign goes through the same safeguarded path.
router.post("/preflight", campaignPreflight);
router.post("/", sendBulk);
router.post("/send-bulk", sendBulk);
router.get("/", getCampaigns);
router.get("/:id/messages", getCampaignMessages);
router.post("/:id/pause", pauseCampaign);
router.post("/:id/resume", resumeCampaign);
router.post("/:id/cancel", cancelCampaign);

module.exports = router;
