const express = require("express");
const router = express.Router();
const {
  handleTwilioIncomingMessage,
  handleTwilioStatusUpdate,
} = require("../../controllers/webhookController");
const { validateTwilioSignature } = require("../../utils/webhookValidator");

router.post("/webhook/twilio/message", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/twilio/incoming", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/incoming", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/message", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/twilio/status", validateTwilioSignature, handleTwilioStatusUpdate);
router.post("/webhook/status", validateTwilioSignature, handleTwilioStatusUpdate);
router.post("/webhooks/status", validateTwilioSignature, handleTwilioStatusUpdate);

module.exports = router;
