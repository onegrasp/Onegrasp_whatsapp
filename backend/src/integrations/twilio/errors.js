// Maps Twilio (WhatsApp) error codes to internal categories. Categories drive
// retry behaviour (retryWorker), contact flags and automatic campaign pausing
// (campaignGuard), so a wrong category has real consequences.
//
//   rate_limit           retried with backoff; pauses the campaign if it persists
//   marketing_limit      Meta held back a marketing message — never retried quickly
//   invalid_phone        number can't receive WhatsApp — contact is flagged
//   account_restricted   sender/account problem — campaign pauses immediately
//   policy_violation     message blocked by WhatsApp policy — campaign pauses
const KNOWN_ERRORS = {
  63016: {
    category: "session_window_expired",
    message: "Outside the 24-hour window. Send an approved template, or wait for the customer to message you first.",
  },
  63018: {
    category: "rate_limit",
    message: "WhatsApp rate limit reached (too many messages, or the daily limit for new conversations).",
  },
  20429: { category: "rate_limit", message: "Too many requests to Twilio." },
  63038: { category: "rate_limit", message: "Account reached its daily message limit." },
  63049: {
    category: "marketing_limit",
    message: "Meta held back this marketing message (per-person marketing limit, or a US number). It was not retried.",
  },
  63032: {
    category: "marketing_limit",
    message: "WhatsApp did not deliver this message to this user (WhatsApp limitation). It was not retried.",
  },
  21610: { category: "opt_out", message: "Recipient has opted out of receiving messages." },
  21211: { category: "invalid_phone", message: "Invalid phone number." },
  21614: { category: "invalid_phone", message: "Number can't receive messages on this channel." },
  63003: { category: "invalid_phone", message: "Number isn't on WhatsApp or can't be reached." },
  63024: { category: "invalid_phone", message: "Invalid message recipient (number isn't on WhatsApp)." },
  63015: {
    category: "sandbox_not_joined",
    message: "This number hasn't joined the Twilio Sandbox. Use production mode or join the sandbox first.",
  },
  63027: { category: "template_rejection", message: "Template doesn't exist for this language, or isn't approved." },
  63028: { category: "template_param_mismatch", message: "Number of template variables doesn't match the approved template." },
  63112: {
    category: "account_restricted",
    message: "Meta restricted or disabled the WhatsApp Business account for this sender.",
  },
  63013: { category: "policy_violation", message: "Message blocked by WhatsApp policy." },
  20003: { category: "auth_error", message: "Twilio authentication failed. Check the Account SID and credentials." },
};

const mapTwilioError = (err) => {
  const rawCode = err.code || err.status || null;
  const code = rawCode !== null && !Number.isNaN(Number(rawCode)) ? Number(rawCode) : rawCode;
  const known = KNOWN_ERRORS[code];

  if (known) {
    return { code, category: known.category, message: `Twilio Error ${code}: ${known.message}` };
  }

  const message = err.message || String(err);
  let category = "other";
  if (!code) {
    if (message.toLowerCase().includes("timeout")) category = "timeout";
    else if (message.toLowerCase().includes("auth") || message.toLowerCase().includes("credential")) category = "auth_error";
  }
  return { code, message, category };
};

module.exports = { mapTwilioError, KNOWN_ERRORS };
