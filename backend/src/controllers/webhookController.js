const eventBus = require("../events/eventBus");
const { verifySignature, normalizePayload } = require("../integrations/twilio/webhook.service");
const { mapStatus } = require("../integrations/twilio/status.service");
const { mapTwilioError } = require("../integrations/twilio/errors");
const logger = require("../utils/logger");

const handleTwilioIncomingMessage = async (req, res, next) => {
  try {
    const isSignatureValid = await verifySignature(req);
    if (!isSignatureValid) {
      return res.status(403).send("Forbidden: Invalid Twilio signature");
    }

    const payload = normalizePayload(req.body);
    logger.info("Normalizing incoming message payload for event publication", { messageSid: payload.messageSid });

    let type = "text";
    if (payload.numMedia > 0) {
      const mediaType = payload.mediaType0 || "";
      if (mediaType.startsWith("image/")) {
        type = "image";
      } else if (mediaType.startsWith("audio/")) {
        type = "audio";
      } else {
        type = "document";
      }
    }

    eventBus.publish("IncomingMessageEvent", {
      from: payload.from,
      to: payload.to,
      messageSid: payload.messageSid,
      body: payload.body,
      profileName: payload.profileName,
      type,
    });

    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    next(err);
  }
};

const handleTwilioStatusUpdate = async (req, res, next) => {
  try {
    const isSignatureValid = await verifySignature(req);
    if (!isSignatureValid) {
      return res.status(403).send("Forbidden: Invalid Twilio signature");
    }

    const payload = normalizePayload(req.body);
    logger.info("Normalizing status update payload for event publication", { messageSid: payload.messageSid, status: payload.messageStatus });

    const mappedStatus = mapStatus(payload.messageStatus);

    let errorDetails = null;
    let errorCategory = null;

    if (payload.messageStatus === "failed" || payload.messageStatus === "undelivered") {
      const errorMap = mapTwilioError({ code: parseInt(payload.errorCode, 10), message: payload.errorMessage });
      errorDetails = `Twilio Error ${payload.errorCode}: ${payload.errorMessage}`.trim();
      errorCategory = errorMap.category;
    }

    eventBus.publish("MessageStatusEvent", {
      phone: payload.to,
      messageSid: payload.messageSid,
      status: mappedStatus,
      errorDetails,
      errorCategory,
    });

    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    next(err);
  }
};

module.exports = {
  handleTwilioIncomingMessage,
  handleTwilioStatusUpdate,
};
