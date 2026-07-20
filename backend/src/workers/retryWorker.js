const jobRepository = require("../repositories/jobRepository");
const contactRepository = require("../repositories/contactRepository");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

const scheduleRetry = async (job, err) => {
  const errorMsg = err.message || String(err);
  const errorCode = err.code || "";
  const errorCategory = err.category || "other";

  logger.error(`Job ${job.id} failed: ${errorMsg}`, { phone: job.phone, errorCode, errorCategory });

  const isPersistent =
    errorCategory === "invalid_phone" ||
    errorCategory === "template_rejection" ||
    errorCategory === "auth_error" ||
    errorCategory === "opt_out";

  const nextAttempts = job.attempts + 1;

  if (isPersistent || nextAttempts >= job.max_attempts) {
    await jobRepository.update(job.id, { status: "failed", error: errorMsg, attempts: nextAttempts });

    if (errorCategory === "opt_out") {
      try {
        logger.info(`Deactivating contact due to opt-out error for phone: ${job.phone}`);
        await contactRepository.deactivateByPhone(job.phone);
      } catch (optErr) {
        logger.error(`Failed to handle opt-out for contact ${job.phone}:`, { error: optErr });
      }
    }

    const contact = await contactRepository.findByPhone(job.phone);
    const failText = job.message || `[Template: ${job.template_name}]`;
    const failTime = new Date().toISOString();

    const savedMsg = await messageRepository.create({
      phone: job.phone,
      contact_name: contact?.name || "",
      text: failText,
      type: job.type === "template" ? "template" : "text",
      direction: "outgoing",
      status: "failed",
      error_details: errorMsg,
      error_category: errorCategory,
      template_name: job.template_name || "",
      campaign_id: job.campaign_id,
      timestamp: failTime,
    });

    await conversationRepository.upsert({
      phone: job.phone,
      contact_name: contact?.name || job.phone,
      last_message: failText,
      last_direction: "outgoing",
      last_status: "failed",
      last_timestamp: failTime,
    });

    const io = getIo();
    if (io) {
      io.emit("new_message", {
        _id: savedMsg?.id,
        phone: job.phone,
        contactName: contact?.name || "",
        text: failText,
        type: job.type === "template" ? "template" : "text",
        direction: "outgoing",
        status: "failed",
        messageId: "",
        templateName: job.template_name,
        campaignId: job.campaign_id,
        timestamp: failTime,
      });
    }

    return { type: "permanent_fail", errorMsg };
  } else {
    const retryTime = new Date(Date.now() + 5000 * nextAttempts).toISOString();
    await jobRepository.update(job.id, {
      status: "pending",
      attempts: nextAttempts,
      error: errorMsg,
      run_at: retryTime,
    });

    logger.warn(`Rescheduling job ${job.id} for retry in ${5 * nextAttempts} seconds.`);
    return { type: "rescheduled", retryTime };
  }
};

module.exports = { scheduleRetry };
