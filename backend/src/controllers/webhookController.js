const eventBus = require("../events/eventBus");
const { normalizePayload } = require("../integrations/twilio/webhook.service");
const { mapStatus } = require("../integrations/twilio/status.service");
const { mapTwilioError } = require("../integrations/twilio/errors");
const { verifyMetaWebhook, verifyMetaSignature, parseMetaWebhookBody } = require("../integrations/meta/webhook.service");
const env = require("../config/env");
const logger = require("../utils/logger");

const handleMetaWebhookVerification = async (req, res, next) => {
  try {
    const { isValid, challenge } = await verifyMetaWebhook(req);
    if (isValid && challenge) {
      logger.info("Meta Webhook Verification Succeeded");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden: Invalid verification token");
  } catch (err) {
    next(err);
  }
};

const handleMetaWebhookEvent = async (req, res, next) => {
  try {
    // Authenticate the sender via the App Secret signature. Without this, anyone
    // can forge inbound messages and delivery statuses.
    const sig = verifyMetaSignature(req);
    if (sig.configured && !sig.valid) {
      logger.warn("Rejected Meta webhook: invalid X-Hub-Signature-256");
      return res.status(403).send("Forbidden: invalid signature");
    }
    if (!sig.configured) {
      logger.warn("META_APP_SECRET is not set — Meta webhook signatures cannot be verified.");
      if (env.IS_PRODUCTION) {
        return res.status(403).send("Forbidden: signature verification not configured");
      }
    }

    const events = parseMetaWebhookBody(req.body);
    logger.info(`Received Meta Webhook Payload with ${events.length} parsed event(s).`);

    events.forEach((ev) => {
      if (ev.type === "status_update") {
        eventBus.publish("MessageStatusEvent", {
          phone: ev.phone,
          messageSid: ev.messageSid,
          status: ev.status,
          errorDetails: ev.errorDetails,
          errorCategory: ev.errorCategory,
        });
      } else if (ev.type === "incoming_message") {
        eventBus.publish("IncomingMessageEvent", {
          from: ev.from,
          to: ev.to,
          messageSid: ev.messageSid,
          body: ev.body,
          profileName: ev.profileName,
          type: ev.msgType,
        });
      }
    });

    res.status(200).send("EVENT_RECEIVED");
  } catch (err) {
    logger.error("Meta Webhook Processing Error:", { error: err.message });
    res.status(200).send("EVENT_RECEIVED");
  }
};

// Twilio routes are guarded by the validateTwilioSignature middleware, so the
// handlers below can trust the payload.
const handleTwilioIncomingMessage = async (req, res, next) => {
  try {
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
  handleMetaWebhookVerification,
  handleMetaWebhookEvent,
  handleTwilioIncomingMessage,
  handleTwilioStatusUpdate,
};
