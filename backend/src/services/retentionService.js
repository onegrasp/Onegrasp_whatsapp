const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const settingsService = require("./settingsService");
const auditService = require("./auditService");
const logger = require("../utils/logger");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Data retention. Messages (chat, campaign and auto-replies) are kept for
 * `messageRetentionDays` (Settings, default 60) and then deleted for good,
 * together with conversations that have had no activity since. Contacts,
 * campaigns and their totals, templates and the audit log are kept.
 *
 * The period never drops below the campaign cooldown or 30 days, because
 * those checks look back through message history.
 */
const effectiveRetentionDays = (safeguards) => {
  const days = Number(safeguards.messageRetentionDays) || 0;
  if (days <= 0) return 0; // keep forever
  return Math.max(days, settingsService.MIN_RETENTION_DAYS, Number(safeguards.campaignCooldownDays) || 0);
};

const purgeOldMessages = async (now = new Date()) => {
  const days = effectiveRetentionDays(await settingsService.getSafeguards());
  if (!days) return { days: 0, messages: 0, conversations: 0 };

  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
  const messages = await messageRepository.deleteOlderThan(cutoff);
  const conversations = await conversationRepository.deleteInactiveSince(cutoff);

  if (messages || conversations) {
    logger.info(`Retention: deleted ${messages} message(s) and ${conversations} conversation(s) older than ${days} days.`);
    auditService.record("retention_purge", "messages", null, { days, cutoff, messages, conversations }, { userId: "system" });
  }
  return { days, cutoff, messages, conversations };
};

module.exports = { purgeOldMessages, effectiveRetentionDays };
