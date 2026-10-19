const eventBus = require("../eventBus");
const contactRepository = require("../../repositories/contactRepository");
const messageRepository = require("../../repositories/messageRepository");
const conversationRepository = require("../../repositories/conversationRepository");
const jobRepository = require("../../repositories/jobRepository");
const settingsRepository = require("../../repositories/settingsRepository");
const campaignRepository = require("../../repositories/campaignRepository");
const twilioService = require("../../services/twilioService");
const { getIo } = require("../../socket");
const logger = require("../../utils/logger");

const { normalizePhone } = require("../../utils/phone");

const registerHandlers = () => {
  eventBus.subscribe("IncomingMessageEvent", async (payload) => {
    logger.info("Handling IncomingMessageEvent inside event handlers", { messageSid: payload.messageSid });
    const rawFrom = payload.from;
    const from = normalizePhone(rawFrom);
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

      try {
        const settings = await settingsRepository.findAll();
        const config = {};
        (settings || []).forEach((s) => {
          config[s.key] = s.value;
        });

        const autoReplyEnabled = String(config.autoReplyEnabled) === "true";
        if (autoReplyEnabled) {
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
        }
      } catch (settingErr) {
        logger.error("Auto-reply settings lookup failed", { error: settingErr });
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
      const updateData = { status, updated_at: new Date().toISOString() };
      if (errorDetails) updateData.error_details = errorDetails;
      if (errorCategory) updateData.error_category = errorCategory;

      const updated = await messageRepository.updateByMessageId(messageSid, updateData);

      if (updated) {
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

        if (updated.campaign_id) {
          try {
            const campaignId = updated.campaign_id;
            const counts = await jobRepository.getCountsByCampaignId(campaignId);
            const { deliveredCount, readCount } = await messageRepository.countDeliveredAndRead(campaignId);

            // Account for recipients that failed pre-flight validation and
            // never became job rows, so their failures are not overwritten.
            let campaign = null;
            try { campaign = await campaignRepository.findById(campaignId); } catch (e) { /* ignore */ }
            const totalContacts = (campaign && campaign.total_contacts) || counts.total;
            const preflightFailed = Math.max(0, totalContacts - counts.total);

            const processedJobs = counts.completed + counts.failed;
            const totalFailed = counts.failed + preflightFailed;
            const allProcessed = counts.total === 0 ? true : processedJobs >= counts.total;
            const campaignStatus = allProcessed ? "completed" : "running";

            await campaignRepository.update(campaignId, {
              sent_count: counts.completed,
              failed_count: totalFailed,
              delivered_count: deliveredCount,
              read_count: readCount,
              status: campaignStatus,
            });

            const processedIncludingPreflight = processedJobs + preflightFailed;
            const progressPercent = totalContacts > 0 ? Math.round((processedIncludingPreflight / totalContacts) * 100) : 0;

            if (io) {
              if (allProcessed) {
                io.emit("campaign_complete", {
                  campaignId,
                  sentCount: counts.completed,
                  failedCount: totalFailed,
                  total: totalContacts,
                });
              } else {
                io.emit("campaign_progress", {
                  campaignId,
                  phone,
                  status,
                  progress: progressPercent,
                });
              }

              io.emit("campaign_update", {
                campaignId,
                sentCount: counts.completed,
                failedCount: totalFailed,
                deliveredCount: deliveredCount,
                readCount: readCount,
                status: campaignStatus,
              });
            }
          } catch (campaignErr) {
            logger.error("Failed to recalculate campaign counts from status callback:", { campaignId: updated.campaign_id, error: campaignErr });
          }
        }
      }
    } catch (err) {
      logger.error("Error in MessageStatusEvent handler:", { error: err });
    }
  });
};

module.exports = { registerHandlers };
