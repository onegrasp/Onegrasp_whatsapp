// Opt-out / opt-in keyword detection for incoming WhatsApp messages.
// Matches the whole message (ignoring case, spacing and punctuation) so that
// "please stop calling me at work" is not treated as an unsubscribe.

const OPT_OUT_KEYWORDS = new Set([
  "stop",
  "stopall",
  "stop all",
  "unsubscribe",
  "unsub",
  "cancel",
  "end",
  "quit",
  "opt out",
  "optout",
  "remove me",
  "stop promotions", // Meta's marketing opt-out quick-reply button
  "stop messages",
  "no more messages",
]);

const OPT_IN_KEYWORDS = new Set(["start", "unstop", "subscribe", "resume promotions", "opt in", "optin"]);

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** @returns {"opt_out" | "opt_in" | null} */
const detectConsentKeyword = (...candidates) => {
  for (const candidate of candidates) {
    const text = normalize(candidate);
    if (!text) continue;
    if (OPT_OUT_KEYWORDS.has(text)) return "opt_out";
    if (OPT_IN_KEYWORDS.has(text)) return "opt_in";
  }
  return null;
};

const OPT_OUT_CONFIRMATION =
  "You've been unsubscribed and won't receive further messages from us. Reply START to subscribe again.";
const OPT_IN_CONFIRMATION = "You're subscribed again. Reply STOP at any time to unsubscribe.";

module.exports = { detectConsentKeyword, OPT_OUT_CONFIRMATION, OPT_IN_CONFIRMATION };
