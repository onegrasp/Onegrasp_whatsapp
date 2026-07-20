const express = require("express");
const router = Router = express.Router();
const { getConversations, getMessages, getStats, sendMessage } = require("../../controllers/messageController");

router.get("/conversations", getConversations);
router.get("/messages/:phone", getMessages);
router.get("/stats", getStats);
router.post("/send-message", sendMessage);

module.exports = router;
