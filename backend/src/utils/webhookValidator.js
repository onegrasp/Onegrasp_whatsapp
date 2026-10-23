const { verifySignature } = require("../integrations/twilio/webhook.service");

// Route-level guard for Twilio webhooks. The verification logic lives in one
// place (webhook.service) so the middleware and handlers cannot disagree.
const validateTwilioSignature = async (req, res, next) => {
  const isValid = await verifySignature(req);
  if (!isValid) {
    return res.status(403).send("Forbidden: Invalid Twilio signature");
  }
  next();
};

module.exports = { validateTwilioSignature };
