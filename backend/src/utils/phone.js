// Shared phone number validation and normalization utility (E.164 with + format)

// Default country code used to expand bare local numbers. Configure via
// DEFAULT_COUNTRY_CODE (defaults to India, "91", for backward compatibility).
// The 10-digit auto-expansion heuristic below is intentionally applied only
// for India's mobile format; other country codes expand 00/0 prefixes only.
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || "91";

// Invisible characters that spreadsheets and copy/paste often carry along with
// a number (non-breaking spaces, zero-width and direction marks, BOM). They
// render as "?" in some exports.
const INVISIBLE_CHARS = /[\u00A0\u2000-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;

const hasLetters = (str) => /[a-z]/i.test(str);

const normalizePhone = (phoneStr, defaultCountryCode = DEFAULT_CC) => {
  if (!phoneStr) return "";

  let clean = String(phoneStr).replace(INVISIBLE_CHARS, "").trim().replace(/^whatsapp:/i, "");

  // Drop separators and stray symbols (spaces, dashes, dots, brackets, commas,
  // slashes, "?"...). A value with letters is not a phone number, so leave it
  // as-is and let validation reject it.
  clean = hasLetters(clean) ? clean.replace(/[\s\-\(\)\+]/g, "") : clean.replace(/\D/g, "");

  // Strip leading zeroes (e.g., 00919876543210 -> 919876543210, 09876543210 -> 9876543210)
  if (clean.startsWith("00")) {
    clean = clean.slice(2);
  } else if (clean.startsWith("0") && clean.length >= 11) {
    clean = clean.slice(1);
  } else if (clean.startsWith("0") && clean.length === 10) {
    clean = clean.slice(1);
  }

  // If 10 digits starting with 6, 7, 8, or 9 (standard Indian mobile format),
  // expand using the Indian country code only when that is the configured default.
  if (defaultCountryCode === "91" && clean.length === 10 && /^[6-9]/.test(clean)) {
    clean = `${defaultCountryCode}${clean}`;
  }

  return `+${clean}`;
};

const validateAndFormatE164 = (phoneStr, defaultCountryCode = DEFAULT_CC) => {
  if (!phoneStr) return { isValid: false, formatted: "" };

  const formatted = normalizePhone(phoneStr, defaultCountryCode);

  // E.164 regex: + followed by 8 to 14 digits starting with 1-9
  const regex = /^\+[1-9]\d{7,14}$/;

  return {
    isValid: regex.test(formatted),
    formatted,
  };
};

/**
 * Joins a separate country-code value (e.g. a "Country Code" column) with a
 * phone number. Numbers that are already international — a leading + or 00,
 * or longer than a local number and already starting with the code — are
 * returned unchanged.
 */
const applyCountryCode = (countryCode, phoneStr) => {
  const cc = String(countryCode ?? "").replace(/\D/g, "");
  const raw = String(phoneStr ?? "").replace(INVISIBLE_CHARS, "").trim();
  if (!cc || !raw || hasLetters(raw)) return raw;
  if (raw.startsWith("+") || raw.startsWith("00")) return raw;

  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length > 10 && digits.startsWith(cc)) return `+${digits}`;
  return `+${cc}${digits}`;
};

module.exports = {
  normalizePhone,
  validateAndFormatE164,
  applyCountryCode,
  INVISIBLE_CHARS,
};
