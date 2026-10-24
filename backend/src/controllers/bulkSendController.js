const supabase = require("../utils/supabase");
const logger = require("../utils/logger");
const { validateTemplateParameters } = require("../utils/templateHelper");
const templateRepository = require("../repositories/templateRepository");
const jobRepository = require("../repositories/jobRepository");
const templateService = require("../services/templateService");
const {
  analyzeRecipients,
  getDailyUsage,
  assignRunTimes,
  adjustForQuietHours,
  getSafeguards,
  markQuietHoursOverride,
} = require("../services/sendingPolicy");

const MAX_BULK_RECIPIENTS = 20000;
const JOB_INSERT_CHUNK = 1000;

const resolveCooldown = (requested, safeguards) =>
  requested === undefined || requested === null || requested === ""
    ? safeguards.campaignCooldownDays
    : Math.max(0, Number(requested) || 0);

const requestedStartFrom = (scheduledAt) =>
  scheduledAt && new Date(scheduledAt) > new Date() ? new Date(scheduledAt) : new Date();

const consentMissing = (analysis) =>
  analysis.sendable.filter((phone) => analysis.contactByPhone.get(phone)?.consent_status !== "opted_in").length;

/**
 * POST /campaigns/preflight — what would happen if this campaign were sent:
 * who is skipped and why, daily-limit usage, and when it would start.
 */
const campaignPreflight = async (req, res, next) => {
  try {
    const { phones = [], type = "template", templateName, mediaUrl = "", skipRecentDays, requireConsent = false, scheduledAt = null } = req.body || {};
    if (!Array.isArray(phones)) return res.status(400).json({ error: "phones must be an array" });
    if (phones.length > MAX_BULK_RECIPIENTS) {
      return res.status(400).json({ error: `A campaign can have at most ${MAX_BULK_RECIPIENTS.toLocaleString("en-US")} recipients.` });
    }

    // A template WhatsApp hasn't approved, or an image added to a template
    // without one, is rejected for every recipient.
    const templateCheck = type === "template" && templateName ? await templateService.checkSendable(templateName, { mediaUrl }) : { ok: true };

    const safeguards = await getSafeguards();
    const cooldownDays = resolveCooldown(skipRecentDays, safeguards);
    const analysis = await analyzeRecipients(phones, { skipRecentDays: cooldownDays, requireConsent: Boolean(requireConsent) });

    const limit = type === "template" ? safeguards.dailyConversationLimit : 0;
    const usage = limit > 0 ? await getDailyUsage(limit) : { limit: 0, used: null, remaining: null };

    const requestedStart = requestedStartFrom(scheduledAt);
    const start = adjustForQuietHours(requestedStart, safeguards);

    res.json({
      templateBlocked: templateCheck.ok ? null : templateCheck.message,
      templateStatus: templateCheck.status || templateCheck.template?.status || null,
      selected: phones.length,
      willSend: analysis.sendable.length,
      invalidFormat: analysis.invalidFormat.length,
      optedOut: analysis.optedOut.length,
      recentlyContacted: analysis.recentlyContacted.length,
      noConsent: analysis.noConsent.length,
      withoutConsent: consentMissing(analysis),
      notOnWhatsApp: analysis.notOnWhatsApp.length,
      cooldownDays,
      dailyLimit: usage,
      startsAt: start.toISOString(),
      delayedByQuietHours: start.getTime() !== requestedStart.getTime(),
      quietHours: {
        enabled: safeguards.quietHoursEnabled,
        start: safeguards.quietHoursStart,
        end: safeguards.quietHoursEnd,
        timeZone: safeguards.quietHoursTimezone,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Saves a campaign's jobs on hold, then releases them in one update. If any
// part fails, whatever was saved is cancelled and the error is rethrown, so a
// failed attempt sends nothing and can safely be retried. (Saving them as
// runnable straight away let the first chunks send while a later chunk failed.)
const queueJobsAllOrNothing = async (campaignId, jobs) => {
  try {
    for (let i = 0; i < jobs.length; i += JOB_INSERT_CHUNK) {
      await jobRepository.insertMany(jobs.slice(i, i + JOB_INSERT_CHUNK));
    }
    await jobRepository.setStatusForCampaign(campaignId, ["paused"], "pending");
  } catch (err) {
    await jobRepository.setStatusForCampaign(campaignId, ["paused", "pending"], "cancelled").catch(() => {});
    throw err;
  }
};

// Records a recipient that was rejected before sending, so it appears in the
// campaign log and the chat history.
const recordPreflightFailure = async ({ campaignId, phone, name, text, type, details, category }) => {
  const failTime = new Date().toISOString();
  await supabase.from("messages").insert([
    {
      phone,
      contact_name: name || "",
      text,
      type: type === "template" ? "template" : "text",
      direction: "outgoing",
      status: "failed",
      error_details: details,
      error_category: category,
      campaign_id: campaignId,
      timestamp: failTime,
    },
  ]);
  await supabase.from("conversations").upsert({
    phone,
    contact_name: name || phone,
    last_message: text,
    last_direction: "outgoing",
    last_status: "failed",
    last_timestamp: failTime,
  });
};

/**
 * POST /send-bulk — creates a campaign and queues one job per recipient.
 * Applies the sending safeguards: opt-outs are never messaged, recently
 * contacted (and, if requested, non-consented) contacts are left out, the
 * start moves past quiet hours, and template campaigns can be split across
 * days to stay within the WhatsApp daily conversation limit.
 */
const sendBulk = async (req, res) => {
  const io = req.app.get("io");
  const {
    phones,
    templateName,
    message,
    campaignName,
    type = "template",
    params = [],
    mediaUrl = "",
    scheduledAt = null,
    skipRecentDays,
    requireConsent = false,
    splitAcrossDays = false,
    // Admin chose "Send now anyway" during quiet hours.
    ignoreQuietHours = false,
  } = req.body || {};

  if (!Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ error: "No phone numbers provided" });
  }
  if (phones.length > MAX_BULK_RECIPIENTS) {
    return res.status(400).json({
      error: `Too many recipients in a single campaign (${phones.length}). Maximum is ${MAX_BULK_RECIPIENTS}; split into multiple campaigns.`,
    });
  }
  if (type === "template" && !templateName) {
    return res.status(400).json({ error: "Template name/content is required" });
  }
  if (type === "text" && !message && !mediaUrl) {
    return res.status(400).json({ error: "Message text or an image is required" });
  }

  if (type === "template" && templateName) {
    try {
      let tpl = await templateRepository.findByName(templateName);
      if (!tpl) tpl = await templateRepository.findByContentSid(templateName);
      if (!tpl) tpl = await templateRepository.findById(templateName);
      if (tpl && tpl.body) {
        const valRes = validateTemplateParameters(tpl.body, params);
        if (!valRes.isValid) {
          logger.warn(`Template parameter validation failed for campaign bulk send: ${valRes.error}`);
          return res.status(400).json({ error: valRes.error });
        }
      }
    } catch (valErr) {
      logger.warn("Could not pre-validate template parameters:", { error: valErr.message });
    }
  }

  if (type === "template" && templateName) {
    try {
      const templateCheck = await templateService.checkSendable(templateName, { mediaUrl });
      if (!templateCheck.ok) return res.status(400).json({ error: templateCheck.message, templateStatus: templateCheck.status });
    } catch (checkErr) {
      logger.warn("Could not verify template approval before sending:", { error: checkErr.message });
    }
  }

  // Strip null bytes and cap free text at WhatsApp's 4096-character limit.
  let sanitizedMessage = message || "";
  if (type === "text" && message) {
    sanitizedMessage = message.replace(/\0/g, "").slice(0, 4096);
  }

  try {
    const safeguards = await getSafeguards();
    const cooldownDays = resolveCooldown(skipRecentDays, safeguards);
    const analysis = await analyzeRecipients(phones, { skipRecentDays: cooldownDays, requireConsent: Boolean(requireConsent) });
    const { sendable, optedOut, invalidFormat, recentlyContacted, noConsent, contactByPhone } = analysis;

    const totalContacts = sendable.length + optedOut.length + invalidFormat.length;
    if (totalContacts === 0) {
      return res.status(400).json({
        error: "Nobody left to send to: every selected contact was skipped (messaged recently or no recorded consent).",
        skippedRecent: recentlyContacted.length,
        skippedNoConsent: noConsent.length,
      });
    }

    const requestedStart = requestedStartFrom(scheduledAt);
    const start = ignoreQuietHours ? requestedStart : adjustForQuietHours(requestedStart, safeguards);

    const limit = type === "template" ? safeguards.dailyConversationLimit : 0;
    const usage = limit > 0 ? await getDailyUsage(limit) : null;
    const runTimes = assignRunTimes(sendable.length, {
      start,
      limit,
      remaining: usage ? usage.remaining : null,
      split: Boolean(splitAcrossDays) && limit > 0,
    });

    const startsLater = start.getTime() > Date.now() + 5000;
    const campaignRow = {
      name: campaignName || `Campaign ${new Date().toLocaleDateString()}`,
      message: sanitizedMessage || "",
      template_name: templateName || "",
      type,
      total_contacts: totalContacts,
      status: startsLater ? "scheduled" : "running",
      ...(ignoreQuietHours ? { ignore_quiet_hours: true } : {}),
    };
    const insertCampaign = (row) => supabase.from("campaigns").insert([row]).select().single();

    let { data: campaign, error: campError } = await insertCampaign(campaignRow);
    if (campError && ignoreQuietHours && /ignore_quiet_hours/.test(campError.message || "")) {
      // Migration 006 not run yet: the in-memory override below still applies.
      const { ignore_quiet_hours, ...rowWithoutFlag } = campaignRow;
      ({ data: campaign, error: campError } = await insertCampaign(rowWithoutFlag));
    }
    if (!campError && campaign && ignoreQuietHours) {
      markQuietHoursOverride(campaign.id);
      logger.warn(`Campaign ${campaign.id} sent during quiet hours by admin override.`);
    }

    if (campError) {
      logger.error("Failed to create campaign in Supabase:", { error: campError });
      return res.status(500).json({ error: "Failed to create campaign database entry" });
    }

    logger.info(
      `Starting campaign: ${campaign.name} (${campaign.id}) for ${sendable.length} contacts; ` +
        `${recentlyContacted.length} skipped as recently messaged, ${noConsent.length} without consent.`
    );

    const failText = sanitizedMessage || `[Template: ${templateName}]`;
    for (const raw of invalidFormat) {
      await recordPreflightFailure({
        campaignId: campaign.id,
        phone: raw,
        name: raw,
        text: failText,
        type,
        details: "Invalid phone number format. Must be E.164 (e.g., +1234567890).",
        category: "invalid_phone",
      });
    }
    for (const phone of optedOut) {
      await recordPreflightFailure({
        campaignId: campaign.id,
        phone,
        name: contactByPhone.get(phone)?.name,
        text: failText,
        type,
        details: "Contact has opted out. Not sent.",
        category: "opt_out",
      });
    }

    const jobsToInsert = sendable.map((phone, i) => {
      const contactName = contactByPhone.get(phone)?.name || "Customer";
      const resolvedParams = (params || []).map((p) => {
        if (p === "{{contact_name}}") return contactName;
        if (p === "{{contact_phone}}") return phone;
        return p;
      });
      const resolvedMsgText = type === "text" && sanitizedMessage
        ? sanitizedMessage.replace(/\{\{contact_name\}\}/g, contactName).replace(/\{\{contact_phone\}\}/g, phone)
        : sanitizedMessage || "";

      return {
        campaign_id: campaign.id,
        phone,
        type,
        template_name: templateName,
        message: resolvedMsgText,
        params: resolvedParams,
        media_url: mediaUrl,
        // Held until every job is saved (see queueJobsAllOrNothing).
        status: "paused",
        run_at: runTimes[i].toISOString(),
      };
    });

    try {
      await queueJobsAllOrNothing(campaign.id, jobsToInsert);
    } catch (queueErr) {
      logger.error("Failed to queue campaign jobs; nothing was sent", { campaignId: campaign.id, error: queueErr });
      await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaign.id);
      return res.status(500).json({ error: "The campaign couldn't be queued, so nothing was sent. Please try again." });
    }
    logger.info(`Queued ${jobsToInsert.length} sending tasks inside campaign ${campaign.id}`);

    const immediateFailures = invalidFormat.length + optedOut.length;
    if (immediateFailures === totalContacts) {
      await supabase.from("campaigns").update({ status: "failed", failed_count: immediateFailures }).eq("id", campaign.id);
      if (io) {
        io.emit("campaign_complete", { campaignId: campaign.id, sentCount: 0, failedCount: immediateFailures, total: totalContacts });
      }
    } else if (immediateFailures > 0) {
      await supabase.from("campaigns").update({ failed_count: immediateFailures }).eq("id", campaign.id);
    }

    const batchDays = new Set(runTimes.map((t) => t.toISOString().slice(0, 10)));
    res.json({
      message: "Campaign queued successfully",
      campaignId: campaign.id,
      total: totalContacts,
      queued: jobsToInsert.length,
      failed: immediateFailures,
      skippedRecent: recentlyContacted.length,
      skippedNoConsent: noConsent.length,
      startsAt: start.toISOString(),
      delayedByQuietHours: start.getTime() !== requestedStart.getTime(),
      batches: batchDays.size,
      lastBatchAt: runTimes.length ? runTimes[runTimes.length - 1].toISOString() : start.toISOString(),
    });
  } catch (err) {
    logger.error("Bulk send failed", { error: err });
    res.status(500).json({ error: "The campaign couldn't be started. Please try again." });
  }
};

module.exports = { sendBulk, campaignPreflight, queueJobsAllOrNothing };
