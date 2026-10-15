const crypto = require("crypto");
const { getMetaConfig } = require("./client");
const { mapMetaError } = require("./errors");
const logger = require("../../utils/logger");

const verifyMetaWebhook = async (req) => {
  const config = await getMetaConfig();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === (config.verifyToken || "whatsapp_system_verify_token")) {
      logger.info("Meta Webhook Verified Successfully");
      return { isValid: true, challenge };
    }
  }
  return { isValid: false, challenge: null };
};

const verifyMetaSignature = async (req) => {
  const config = await getMetaConfig();
  const signature = req.headers["x-hub-signature-256"];

  if (!signature || !config.accessToken) {
    // If no app secret signature header or unconfigured, bypass or warn
    return true;
  }

  try {
    const elements = signature.split("=");
    const signatureHash = elements[1];
    const expectedHash = crypto
      .createHmac("sha256", config.accessToken)
      .update(JSON.stringify(req.body))
      .digest("hex");

    return crypto.timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expectedHash));
  } catch (err) {
    logger.warn("Meta signature verification failed:", { error: err.message });
    return false;
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
