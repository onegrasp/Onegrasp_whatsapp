const express = require("express");
const router = express.Router();
const { sendBulk, sendSingle, getCampaigns, getCampaignMessages } = require("../controllers/sendController");

router.post("/send-bulk", sendBulk);
router.post("/send-message", sendSingle);
router.get("/campaigns", getCampaigns);
router.get("/campaigns/:id/messages", getCampaignMessages);

module.exports = router;
