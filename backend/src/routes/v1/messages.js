const express = require("express");
const router = express.Router();
const { getConversations, getMessages, getStats, sendMessage } = require("../../controllers/messageController");
const { sendBulk, sendSingle } = require("../../controllers/sendController");

router.get("/conversations", getConversations);
router.get("/messages/:phone", getMessages);
router.get("/stats", getStats);

// Single and Bulk Message sending endpoints
router.post("/send-message", sendSingle);
router.post("/send-single", sendSingle);
router.post("/send/single", sendSingle);

router.post("/send-bulk", sendBulk);
router.post("/send/bulk", sendBulk);

module.exports = router;
