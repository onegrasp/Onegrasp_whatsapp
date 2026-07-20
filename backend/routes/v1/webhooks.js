const express = require("express");
const router = express.Router();
const {
  handleTwilioIncomingMessage,
  handleTwilioStatusUpdate,
} = require("../../controllers/webhookController");
const { validateTwilioSignature } = require("../../utils/webhookValidator");

router.post("/webhook/twilio/message", validateTwilioSignature, handleTwilioIncomingMessage);
router.post("/webhook/twilio/status", validateTwilioSignature, handleTwilioStatusUpdate);

module.exports = router;
