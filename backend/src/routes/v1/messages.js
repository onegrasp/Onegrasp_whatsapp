const express = require("express");
const router = express.Router();
const { getConversations, getMessages, getStats, sendMessage } = require("../../controllers/messageController");
const { sendBulk } = require("../../controllers/campaignController");

router.get("/conversations", getConversations);
router.get("/messages/:phone", getMessages);
router.get("/stats", getStats);
router.post("/send-message", sendMessage);
router.post("/send-bulk", sendBulk);

module.exports = router;
