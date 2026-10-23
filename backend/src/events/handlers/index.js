const eventBus = require("../eventBus");
const contactRepository = require("../../repositories/contactRepository");
const messageRepository = require("../../repositories/messageRepository");
const conversationRepository = require("../../repositories/conversationRepository");
const jobRepository = require("../../repositories/jobRepository");
const settingsRepository = require("../../repositories/settingsRepository");
const twilioService = require("../../services/twilioService");
const settingsService = require("../../services/settingsService");
const { refreshCampaignProgress } = require("../../services/campaignProgress");
const { onCampaignFailure } = require("../../services/campaignControl");
const { handleConsentKeyword } = require("../../services/optOutService");
const { detectConsentKeyword } = require("../../utils/keywords");
const { getIo } = require("../../socket");
const logger = require("../../utils/logger");

const { normalizePhone } = require("../../utils/phone");

const STATUS_RANK = { queued: 0, accepted: 1, sending: 1, sent: 2, delivered: 3, read: 4 };
const FAILURE_STATUSES = new Set(["failed", "undelivered"]);

// Providers can deliver status callbacks out of order (e.g. "delivered" after
// "read"). A message should only ever move forward, or the ticks regress.
const isStatusRegression = (current, next) => {
  if (!current || current === next) return false;
  if (FAILURE_STATUSES.has(next)) return current === "delivered" || current === "read";
  const currentRank = STATUS_RANK[current];
  const nextRank = STATUS_RANK[next];
  if (currentRank === undefined || nextRank === undefined) return false;
  return nextRank < currentRank;
};

/**
 * Auto-reply only when it helps: not while an agent (or a previous
 * auto-reply) has written to this person within the cooldown, and not when an
 * auto-reply is already queued. Prevents reply storms and bot-to-bot loops.
 */
const shouldAutoReply = async (phone, cooldownHours) => {
  if (await jobRepository.hasPendingAutoReply(phone)) return false;
  if (cooldownHours > 0) {
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();
    if (await messageRepository.hasNonCampaignOutgoingSince(phone, since)) return false;
  }
  return true;
};

const queueAutoReply = async (from) => {
  const settings = await settingsRepository.findAll();
  const config = {};
  (settings || []).forEach((s) => {
    config[s.key] = s.value;
  });
  if (String(config.autoReplyEnabled) !== "true") return;

  const { autoReplyCooldownHours } = await settingsService.getSafeguards();
  if (!(await shouldAutoReply(from, autoReplyCooldownHours))) {
    logger.info(`Auto-reply skipped for ${from} (cooldown or conversation in progress).`);
    return;
  }

  const autoReplyMessage = config.autoReplyMessage || "Thank you for reaching out! We have received your message.";
  logger.info(`Queuing auto-reply job to ${from}`);
  await jobRepository.create({
    campaign_id: null,
    phone: from,
    type: "text",
    message: autoReplyMessage,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    run_at: new Date(Date.now() + 1000).toISOString(),
  });
};

const registerHandlers = () => {
  eventBus.subscribe("IncomingMessageEvent", async (payload) => {
    logger.info("Handling IncomingMessageEvent inside event handlers", { messageSid: payload.messageSid });
    const from = normalizePhone(payload.from);
    const { messageSid, body, profileName } = payload;
    const io = getIo();

    try {
      // Webhook deliveries are at-least-once. If we have already stored this
      // provider message id, skip it so unread counts are not double-incremented
      // and duplicate rows are not attempted.
      if (messageSid) {
        const existingMsg = await messageRepository.findByMessageId(messageSid).catch(() => null);
        if (existingMsg) {
          logger.info("Duplicate inbound webhook ignored", { messageSid });
          return;
        }
      }

      let contact = await contactRepository.findByPhone(from);
      if (!contact) {
        try {
          contact = await contactRepository.upsert(from, profileName || from);
        } catch (err) {
          contact = await contactRepository.findByPhone(from);
          if (!contact) throw err;
        }
      } else if (profileName && (contact.name === from || contact.name === "Unknown" || contact.name === "Customer" || !contact.name)) {
        try {
          contact = await contactRepository.upsert(from, profileName, contact.label || "none");
        } catch (err) {
          // Ignore name update error
        }
      }

      const msgTime = new Date().toISOString();

      const savedMsg = await messageRepository.create({
        phone: from,
        contact_name: contact.name,
        text: body,
        type: payload.type || "text",
        direction: "incoming",
        status: "delivered",
        message_id: messageSid,
        timestamp: msgTime,
      });

      const existingConv = await conversationRepository.findByPhone(from);
      const currentUnread = (existingConv?.unread_count || 0) + 1;

      await conversationRepository.upsert({
        phone: from,
        contact_name: contact.name,
        last_message: body,
        last_direction: "incoming",
        last_status: "delivered",
        last_timestamp: msgTime,
        unread_count: currentUnread,
      });

      try {
        await twilioService.markAsRead(messageSid);
      } catch (e) {
        logger.warn(`Failed to mark incoming message ${messageSid} as read in Twilio`, { error: e });
      }

      if (io) {
        io.emit("new_message", {
          _id: savedMsg.id,
          phone: savedMsg.phone,
          contactName: savedMsg.contact_name,
          text: savedMsg.text,
          type: savedMsg.type,
          direction: savedMsg.direction,
          status: savedMsg.status,
          messageId: savedMsg.message_id,
          timestamp: savedMsg.timestamp,
        });

        io.emit("incoming_message", {
          phone: from,
          contactName: contact.name,
          text: body,
          timestamp: savedMsg.timestamp,
          messageId: savedMsg.id,
        });
      }

      // They wrote to us, so the number is clearly on WhatsApp.
      contactRepository.clearInvalid(from).catch(() => {});

      // STOP / START (and Meta's "Stop promotions" button) take priority and
      // replace the auto-reply with a confirmation.
      const keyword = detectConsentKeyword(body, payload.buttonText, payload.buttonPayload);
      if (keyword) {
        await handleConsentKeyword(keyword, from, contact.name);
        return;
      }

      try {
        await queueAutoReply(from);
      } catch (settingErr) {
        logger.error("Auto-reply could not be queued", { error: settingErr });
      }
    } catch (err) {
      logger.error("Error in IncomingMessageEvent handler:", { error: err });
    }
  });

  eventBus.subscribe("MessageStatusEvent", async (payload) => {
    logger.info("Handling MessageStatusEvent inside event handlers", { messageSid: payload.messageSid, status: payload.status });
    const { phone: rawPhone, messageSid, status, errorDetails, errorCategory } = payload;
    const phone = normalizePhone(rawPhone);
    const io = getIo();

    try {
      const existing = await messageRepository.findByMessageId(messageSid).catch(() => null);
      if (existing && isStatusRegression(existing.status, status)) {
        logger.info(`Ignoring out-of-order status '${status}' for ${messageSid} (already '${existing.status}')`);
        return;
      }

      const updateData = { status, updated_at: new Date().toISOString() };
      if (errorDetails) updateData.error_details = errorDetails;
      if (errorCategory) updateData.error_category = errorCategory;

      const updated = await messageRepository.updateByMessageId(messageSid, updateData);
      if (!updated) return;

      logger.info(`Updated message ${messageSid} status to: ${status}`);

      const conversation = await conversationRepository.findByPhone(phone);
      if (conversation) {
        await conversationRepository.updateLastStatus(phone, status);
      }

      if (io) {
        io.emit("status_update", {
          messageId: messageSid,
          phone,
          status,
          errorDetails: updated.error_details,
        });
      }

      // Most WhatsApp delivery failures arrive here, after the send succeeded.
      if (FAILURE_STATUSES.has(status)) {
        if (errorCategory === "invalid_phone") await contactRepository.markInvalid(phone, errorDetails);
        if (errorCategory === "opt_out") await contactRepository.setOptOut(phone, { reason: "provider_opt_out", source: "provider_error" });
        if (updated.campaign_id) await onCampaignFailure(updated.campaign_id, errorCategory);
      } else if (status === "delivered") {
        contactRepository.clearInvalid(phone).catch(() => {});
      }

      if (updated.campaign_id) {
        await refreshCampaignProgress(updated.campaign_id, { phone, status });
      }
    } catch (err) {
      logger.error("Error in MessageStatusEvent handler:", { error: err });
    }
  });
};

module.exports = { registerHandlers, isStatusRegression, shouldAutoReply };
