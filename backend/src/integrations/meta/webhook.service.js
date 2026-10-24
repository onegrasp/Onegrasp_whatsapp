const crypto = require("crypto");
const { getMetaConfig } = require("./client");
const { mapMetaError } = require("./errors");
const logger = require("../../utils/logger");

const verifyMetaWebhook = async (req) => {
  const config = await getMetaConfig();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // No built-in default: without a configured token, verification is refused.
  const expected = config.verifyToken || "";
  if (!expected) {
    logger.warn("Meta webhook verification refused: set META_WEBHOOK_VERIFY_TOKEN first.");
    return { isValid: false, challenge: null };
  }
  if (mode === "subscribe" && typeof token === "string" && token.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    logger.info("Meta Webhook Verified Successfully");
    return { isValid: true, challenge };
  }
  return { isValid: false, challenge: null };
};

/**
 * Verify Meta's X-Hub-Signature-256 header. Meta signs the *raw* request body
 * with the App Secret (not the access token) using HMAC-SHA256. We therefore
 * verify against `req.rawBody` (captured by the JSON body parser) and the
 * configured META_APP_SECRET.
 *
 * Returns { configured, valid }:
 *   configured=false -> no app secret set, so verification cannot be performed
 *   valid            -> whether the signature matched (only meaningful when configured)
 */
const verifyMetaSignature = (req) => {
  const env = require("../../config/env");
  const appSecret = env.META_APP_SECRET;

  if (!appSecret) {
    return { configured: false, valid: false };
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !signature.startsWith("sha256=")) {
    return { configured: true, valid: false };
  }

  try {
    const raw = req.rawBody && Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body || {}), "utf8");

    const expected = "sha256=" + crypto
      .createHmac("sha256", appSecret)
      .update(raw)
      .digest("hex");

    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return { configured: true, valid: false };

    return { configured: true, valid: crypto.timingSafeEqual(a, b) };
  } catch (err) {
    logger.warn("Meta signature verification failed:", { error: err.message });
    return { configured: true, valid: false };
  }
};

const parseMetaWebhookBody = (body) => {
  const events = [];

  if (!body || body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) {
    return events;
  }

  body.entry.forEach((entry) => {
    (entry.changes || []).forEach((change) => {
      if (change.field !== "messages" || !change.value) return;

      const value = change.value;

      // 1. Parse Status Updates (sent, delivered, read, failed)
      if (Array.isArray(value.statuses)) {
        value.statuses.forEach((st) => {
          const recipientPhone = st.recipient_id ? `+${st.recipient_id}` : "";
          const messageId = st.id;
          const status = st.status; // "sent", "delivered", "read", "failed"
          let errorDetails = null;
          let errorCategory = null;

          if (status === "failed" && Array.isArray(st.errors) && st.errors.length > 0) {
            const errObj = st.errors[0];
            const mapped = mapMetaError({ error: errObj });
            errorDetails = `Meta Webhook Failure (${errObj.code}): ${errObj.title || errObj.message || "Failed"}${errObj.error_data?.details ? ` - ${errObj.error_data.details}` : ""}`;
            errorCategory = mapped.category;
          }

          events.push({
            type: "status_update",
            phone: recipientPhone,
            messageSid: messageId,
            status,
            errorDetails,
            errorCategory,
            timestamp: new Date(parseInt(st.timestamp, 10) * 1000).toISOString(),
          });
        });
      }

      // 2. Parse Incoming Messages
      if (Array.isArray(value.messages)) {
        const contacts = value.contacts || [];
        const contactMap = {};
        contacts.forEach((c) => {
          if (c.wa_id) {
            contactMap[c.wa_id] = c.profile?.name || "Customer";
          }
        });

        value.messages.forEach((msg) => {
          const fromPhone = `+${msg.from}`;
          const messageId = msg.id;
          const profileName = contactMap[msg.from] || "Customer";
          let msgType = msg.type || "text";
          let bodyText = "";

          if (msgType === "text") {
            bodyText = msg.text?.body || "";
          } else if (msgType === "image") {
            bodyText = msg.image?.caption || "[Image]";
          } else if (msgType === "audio") {
            bodyText = "[Voice Message]";
          } else if (msgType === "document") {
            bodyText = msg.document?.filename ? `[Document: ${msg.document.filename}]` : "[Document]";
          } else if (msgType === "button" || msgType === "interactive") {
            bodyText = msg.button?.text || msg.interactive?.button_reply?.title || "[Button Response]";
          }

          events.push({
            type: "incoming_message",
            from: fromPhone,
            to: value.metadata?.display_phone_number || "",
            messageSid: messageId,
            body: bodyText,
            profileName,
            msgType,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
          });
        });
      }
    });
  });

  return events;
};

module.exports = {
  verifyMetaWebhook,
  verifyMetaSignature,
  parseMetaWebhookBody,
};
