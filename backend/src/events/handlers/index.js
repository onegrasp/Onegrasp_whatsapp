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

const registerHandlers = () => {
  eventBus.subscribe("IncomingMessageEvent", async (payload) => {
    logger.info("Handling IncomingMessageEvent inside event handlers", { messageSid: payload.messageSid });
    const { from, messageSid, body, profileName } = payload;
    const io = getIo();

    try {
      let contact = await contactRepository.findByPhone(from);
      if (!contact) {
        try {
          contact = await contactRepository.upsert(from, profileName || from);
        } catch (err) {
          contact = await contactRepository.findByPhone(from);
          if (!contact) throw err;
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
    const { phone, messageSid, status, errorDetails, errorCategory } = payload;
    const io = getIo();

    try {
      const updateData = { status, updated_at: new Date().toISOString() };
      if (errorDetails) updateData.error_details = errorDetails;
      if (errorCategory) updateData.error_category = errorCategory;

      const updated = await messageRepository.updateByMessageId(messageSid, updateData);

      if (updated) {
        logger.info(`Updated message ${messageSid} status to: ${status}`);

        const conversation = await conversationRepository.findByPhone(phone);
        if (conversation && new Date(conversation.last_timestamp).getTime() === new Date(updated.timestamp).getTime()) {
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

            const processedJobs = counts.completed + counts.failed;
            const campaignStatus = processedJobs === counts.total ? "completed" : "running";

            await campaignRepository.update(campaignId, {
              sent_count: counts.completed,
              failed_count: counts.failed,
              delivered_count: deliveredCount,
              read_count: readCount,
              status: campaignStatus,
            });

            const progressPercent = counts.total > 0 ? Math.round((processedJobs / counts.total) * 100) : 0;

            if (io) {
              if (processedJobs === counts.total) {
                io.emit("campaign_complete", {
                  campaignId,
                  sentCount: counts.completed,
                  failedCount: counts.failed,
                  total: counts.total,
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
                failedCount: counts.failed,
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
