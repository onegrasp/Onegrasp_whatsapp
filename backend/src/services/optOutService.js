const contactRepository = require("../repositories/contactRepository");
const jobRepository = require("../repositories/jobRepository");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const whatsappService = require("./whatsappService");
const { refreshCampaignProgress } = require("./campaignProgress");
const { OPT_OUT_CONFIRMATION, OPT_IN_CONFIRMATION } = require("../utils/keywords");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

// Sends a short confirmation straight away. The customer just wrote to us, so
// this is inside the 24-hour window, and it must go out even though the
// contact is now opted out (the campaign worker would skip it).
const sendSystemReply = async (phone, contactName, text) => {
  try {
    const result = await whatsappService.sendTextMessage(phone, text);
    const saved = await messageRepository.create({
      phone,
      contact_name: contactName || "",
      text,
      type: "text",
      direction: "outgoing",
      status: "sent",
      message_id: result?.messages?.[0]?.id || result?.sid || null,
      timestamp: new Date().toISOString(),
    });
    await conversationRepository
      .upsert({
        phone,
        contact_name: contactName || phone,
        last_message: text,
        last_direction: "outgoing",
        last_status: "sent",
        last_timestamp: saved.timestamp,
      })
      .catch(() => {});

    const io = getIo();
    if (io) {
      io.emit("new_message", {
        _id: saved.id,
        phone,
        contactName,
        text,
        type: "text",
        direction: "outgoing",
        status: "sent",
        messageId: saved.message_id,
        timestamp: saved.timestamp,
      });
    }
  } catch (err) {
    logger.error(`Could not send opt-out/opt-in confirmation to ${phone}`, { error: err });
  }
};

/**
 * Handles a STOP / START style reply. Returns true if the message was a
 * consent keyword (so no auto-reply should follow).
 */
const handleConsentKeyword = async (keyword, phone, contactName) => {
  if (keyword === "opt_out") {
    await contactRepository.setOptOut(phone, { reason: "user_keyword", source: "WhatsApp reply" });
    const cancelled = await jobRepository.cancelPendingForPhone(phone).catch(() => []);
    const campaigns = new Set(cancelled.map((j) => j.campaign_id).filter(Boolean));
    for (const campaignId of campaigns) await refreshCampaignProgress(campaignId);

    logger.info(`Contact ${phone} opted out by keyword; ${cancelled.length} queued message(s) cancelled.`);
    await sendSystemReply(phone, contactName, OPT_OUT_CONFIRMATION);
    return true;
  }

  if (keyword === "opt_in") {
    await contactRepository.clearOptOut(phone, { source: "WhatsApp reply" });
    logger.info(`Contact ${phone} opted back in by keyword.`);
    await sendSystemReply(phone, contactName, OPT_IN_CONFIRMATION);
    return true;
  }

  return false;
};

module.exports = { handleConsentKeyword };
