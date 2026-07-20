const express = require("express");
const router = express.Router();
const { sendBulk, getCampaigns, getCampaignMessages } = require("../../controllers/campaignController");

router.post("/", sendBulk);
router.post("/send-bulk", sendBulk);
router.get("/", getCampaigns);
router.get("/:id/messages", getCampaignMessages);

module.exports = router;
