const express = require("express");
const router = express.Router();
const {
  handleMetaWebhookVerification,
  handleMetaWebhookEvent,
  handleTwilioIncomingMessage,
  handleTwilioStatusUpdate,
} = require("../../controllers/webhookController");
const { validateTwilioSignature } = require("../../utils/webhookValidator");

// Meta WhatsApp Cloud API Webhook Endpoints
router.get("/webhook", handleMetaWebhookVerification);
router.post("/webhook", handleMetaWebhookEvent);
router.get("/meta", handleMetaWebhookVerification);
router.post("/meta", handleMetaWebhookEvent);

// Twilio Webhook Endpoints
router.post("/webhook/twilio/message", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/twilio/incoming", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/incoming", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/message", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/twilio/status", validateTwilioSignature, handleTwilioStatusUpdate);
router.post("/webhook/status", validateTwilioSignature, handleTwilioStatusUpdate);
router.post("/webhooks/status", validateTwilioSignature, handleTwilioStatusUpdate);

module.exports = router;
