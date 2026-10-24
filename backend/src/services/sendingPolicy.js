const contactRepository = require("../repositories/contactRepository");
const messageRepository = require("../repositories/messageRepository");
const settingsService = require("./settingsService");
const { validateAndFormatE164 } = require("../utils/phone");
const { quietHoursEnd } = require("../utils/quietHours");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sorts campaign recipients by what should happen to them. Used both by the
 * pre-send summary and by the send itself, so the numbers shown before
 * sending match what actually happens.
 *
 * Opted-out numbers are always blocked. Numbers messaged by another campaign
 * within the cooldown, and (when required) contacts without recorded consent,
 * are left out of the campaign entirely.
 */
const analyzeRecipients = async (phones, { skipRecentDays = 0, requireConsent = false } = {}) => {
  const invalidFormat = [];
  const formattedList = [];
  const seen = new Set();

  for (const raw of phones || []) {
    const { isValid, formatted } = validateAndFormatE164(raw);
    if (!isValid) {
      invalidFormat.push(raw);
      continue;
    }
    if (seen.has(formatted)) continue; // the same person twice in one campaign
    seen.add(formatted);
    formattedList.push(formatted);
  }

  const contacts = await contactRepository.findDetailedByPhones(formattedList);
  const contactByPhone = new Map(contacts.map((c) => [c.phone, c]));
  const optOutList = await contactRepository.findOptedOutPhones(formattedList);

  const recent = skipRecentDays > 0
    ? await messageRepository.recentlyContactedPhones(formattedList, new Date(Date.now() - skipRecentDays * DAY_MS).toISOString())
    : new Set();

  const optedOut = [];
  const recentlyContacted = [];
  const noConsent = [];
  const notOnWhatsApp = [];
  const sendable = [];

  for (const phone of formattedList) {
    const contact = contactByPhone.get(phone);
    if (optOutList.has(phone) || contact?.is_active === false || contact?.consent_status === "opted_out") {
      optedOut.push(phone);
      continue;
    }
    if (recent.has(phone)) {
      recentlyContacted.push(phone);
      continue;
    }
    if (requireConsent && contact?.consent_status !== "opted_in") {
      noConsent.push(phone);
      continue;
    }
    if (contact?.invalid_reason) notOnWhatsApp.push(phone); // still sent; numbers can join WhatsApp later
    sendable.push(phone);
  }

  return { invalidFormat, optedOut, recentlyContacted, noConsent, notOnWhatsApp, sendable, contactByPhone };
};

// Daily conversation budget for template (business-initiated) campaigns.
const getDailyUsage = async (limit) => {
  const used = await messageRepository.countBusinessInitiatedSince(new Date(Date.now() - DAY_MS).toISOString());
  return { limit, used, remaining: limit > 0 ? Math.max(0, limit - used) : null };
};

/**
 * Run times for `count` messages starting at `start`. With a daily limit, the
 * first `remaining` go at `start` and the rest follow in batches of `limit`,
 * one day apart, so the campaign never exceeds the messaging limit.
 */
const assignRunTimes = (count, { start, limit = 0, remaining = null, split = false }) => {
  const base = start.getTime();
  if (!split || !limit || limit <= 0) return Array.from({ length: count }, () => new Date(base));

  const firstBatch = remaining === null ? limit : remaining;
  return Array.from({ length: count }, (_, i) => {
    if (i < firstBatch) return new Date(base);
    const day = 1 + Math.floor((i - firstBatch) / limit);
    return new Date(base + day * DAY_MS);
  });
};

const quietHoursOptions = (safeguards) => ({
  enabled: safeguards.quietHoursEnabled,
  start: safeguards.quietHoursStart,
  end: safeguards.quietHoursEnd,
  timeZone: safeguards.quietHoursTimezone,
});

// When a campaign starting at `date` would actually begin, given quiet hours.
const adjustForQuietHours = (date, safeguards) => quietHoursEnd(date, quietHoursOptions(safeguards)) || date;

// Campaigns an admin chose to send during quiet hours ("Send now anyway").
// Stored on the campaign (migration 006) and kept here too, so the override
// works even before that migration has run.
const quietHoursOverrides = new Set();
const markQuietHoursOverride = (campaignId) => quietHoursOverrides.add(campaignId);
const hasQuietHoursOverride = (campaign) =>
  Boolean(campaign && (campaign.ignore_quiet_hours === true || quietHoursOverrides.has(campaign.id)));

const getSafeguards = () => settingsService.getSafeguards();

/**
 * Why a one-to-one message to `phone` must not be sent, or null if it may.
 * Opted-out numbers never get templates (business-initiated, usually
 * marketing). A free-form reply is allowed only if the person has written to
 * us since opting out, i.e. we're answering them; WhatsApp's 24-hour window
 * still applies on top.
 */
const optOutBlockReason = async (phone, { template = false } = {}) => {
  const optOut = await contactRepository.findOptOut(phone);
  if (!optOut) return null;
  if (template) {
    return "This contact opted out, so templates can't be sent to them. They can opt back in by replying START.";
  }
  const since = optOut.opted_out_at || optOut.created_at;
  if (since && (await messageRepository.hasIncomingSince(phone, since))) return null;
  return "This contact opted out. You can reply once they message you again, or they can opt back in by replying START.";
};

module.exports = {
  analyzeRecipients,
  getDailyUsage,
  assignRunTimes,
  adjustForQuietHours,
  quietHoursOptions,
  getSafeguards,
  markQuietHoursOverride,
  hasQuietHoursOverride,
  optOutBlockReason,
};
