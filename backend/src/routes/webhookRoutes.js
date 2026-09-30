const express = require("express");
const router = express.Router();
const {
  handleMetaWebhookVerification,
  handleMetaWebhookEvent,
  handleTwilioIncomingMessage,
  handleTwilioStatusUpdate,
} = require("../controllers/webhookController");
const { validateTwilioSignature } = require("../utils/webhookValidator");

// Meta WhatsApp Cloud API Webhooks
router.get("/webhook", handleMetaWebhookVerification);
router.post("/webhook", handleMetaWebhookEvent);
router.get("/api/webhook", handleMetaWebhookVerification);
router.post("/api/webhook", handleMetaWebhookEvent);

// Twilio Webhook Endpoints
router.post("/webhook/twilio/message", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/twilio/status", validateTwilioSignature, handleTwilioStatusUpdate);

module.exports = router;
