const jobRepository = require("../repositories/jobRepository");
const contactRepository = require("../repositories/contactRepository");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const { onCampaignFailure } = require("../services/campaignControl");
const { getIo } = require("../socket");
const logger = require("../utils/logger");

// Failures that retrying won't fix. marketing_limit in particular must not be
// retried quickly: Meta held the message back on purpose.
const PERSISTENT_CATEGORIES = new Set([
  "invalid_phone",
  "template_rejection",
  "template_param_mismatch",
  "message_undeliverable",
  "auth_error",
  "opt_out",
  "session_window_expired",
  "marketing_limit",
  "account_restricted",
  "policy_violation",
  "sandbox_not_joined",
  "invalid_job",
]);

// Records the final failure once (earlier attempts are not logged as
// separate failed messages) and applies its side effects.
const recordPermanentFailure = async (job, err, { errorMsg, errorCategory }) => {
  if (errorCategory === "opt_out") {
    logger.info(`Recording opt-out reported by the provider for ${job.phone}`);
    await contactRepository.setOptOut(job.phone, { reason: "provider_opt_out", source: "provider_error" }).catch((e) =>
      logger.error(`Failed to record opt-out for ${job.phone}:`, { error: e })
    );
  }
  if (errorCategory === "invalid_phone") {
    await contactRepository.markInvalid(job.phone, errorMsg);
  }

  let contact = null;
  try {
    contact = await contactRepository.findByPhone(job.phone);
  } catch (e) {
    // Name is optional.
  }
  const contactName = err.contactName || contact?.name || "";
  const failText = err.displayText || job.message || `[Template: ${job.template_name}]`;
  const failTime = new Date().toISOString();

  let savedMsg = null;
  try {
    savedMsg = await messageRepository.create({
      phone: job.phone,
      contact_name: contactName,
      text: failText,
      type: job.type === "template" ? "template" : "text",
      direction: "outgoing",
      status: "failed",
      error_details: errorMsg,
      error_category: errorCategory,
      template_name: job.template_name || "",
      campaign_id: job.campaign_id,
      media_url: job.media_url || "",
      timestamp: failTime,
    });
  } catch (msgErr) {
    logger.warn("Could not record failed message", { error: msgErr.message });
  }

  try {
    await conversationRepository.upsert({
      phone: job.phone,
      contact_name: contactName || job.phone,
      last_message: failText,
      last_direction: "outgoing",
      last_status: "failed",
      last_timestamp: failTime,
    });
  } catch (convErr) {
    // Conversation summary is best effort.
  }

  const io = getIo();
  if (io) {
    io.emit("new_message", {
      _id: savedMsg?.id || `msg_fail_${Date.now()}`,
      phone: job.phone,
      contactName,
      text: failText,
      type: job.type === "template" ? "template" : "text",
      direction: "outgoing",
      status: "failed",
      errorDetails: errorMsg,
      messageId: "",
      templateName: job.template_name,
      campaignId: job.campaign_id,
      mediaUrl: job.media_url || "",
      timestamp: failTime,
    });
  }

  if (job.campaign_id) await onCampaignFailure(job.campaign_id, errorCategory);
};

const scheduleRetry = async (job, err) => {
  const errorMsg = err.message || String(err);
  const errorCode = err.code || "";
  const errorCategory = err.category || "other";

  logger.error(`Job ${job.id} failed: ${errorMsg}`, { phone: job.phone, errorCode, errorCategory });

  const nextAttempts = job.attempts + 1;

  if (PERSISTENT_CATEGORIES.has(errorCategory) || nextAttempts >= job.max_attempts) {
    try {
      await jobRepository.update(job.id, { status: "failed", error: errorMsg, attempts: nextAttempts });
    } catch (e) {
      // Job row update is best effort.
    }
    await recordPermanentFailure(job, err, { errorMsg, errorCategory });
    return { type: "permanent_fail", errorMsg };
  }

  // Exponential backoff with jitter for rate limits vs standard retry
  const backoffDelayMs = errorCategory === "rate_limit"
    ? Math.pow(2, nextAttempts) * 3000 + Math.floor(Math.random() * 1000)
    : 5000 * nextAttempts;

  const retryTime = new Date(Date.now() + backoffDelayMs).toISOString();
  try {
    await jobRepository.update(job.id, {
      status: "pending",
      attempts: nextAttempts,
      error: errorMsg,
      run_at: retryTime,
    });
  } catch (e) {
    // If this fails the stale-job recovery picks the job up again.
  }

  logger.warn(`Rescheduling job ${job.id} (Category: ${errorCategory}) for retry in ${Math.round(backoffDelayMs / 1000)}s.`);
  return { type: "rescheduled", retryTime };
};

module.exports = { scheduleRetry, PERSISTENT_CATEGORIES };
