// Shared phone number validation and normalization utility (E.164 with + format)

// Country code given to numbers written without one. Configure via
// DEFAULT_COUNTRY_CODE (defaults to India, "91").
//
// A number written with "+" or "00" is international and kept as it is.
// Otherwise a number with a leading trunk "0", or of at most
// MAX_NATIONAL_DIGITS digits, is a national number and gets the default
// country code; a longer one is taken to already start with its country code
// (e.g. 919876543210). A bare national number can't reveal its country, so
// numbers from any other country must include their country code (or come
// with a "Country Code" column on import).
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || "91";
const MAX_NATIONAL_DIGITS = 10;

// Invisible characters that spreadsheets and copy/paste often carry along with
// a number (non-breaking spaces, zero-width and direction marks, BOM). They
// render as "?" in some exports.
const INVISIBLE_CHARS = /[\u00A0\u2000-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;

const hasLetters = (str) => /[a-z]/i.test(str);

const normalizePhone = (phoneStr, defaultCountryCode = DEFAULT_CC) => {
  if (!phoneStr) return "";

  let clean = String(phoneStr).replace(INVISIBLE_CHARS, "").trim().replace(/^whatsapp:/i, "");

  // A value with letters is not a phone number: leave it for validation to reject.
  if (hasLetters(clean)) return `+${clean.replace(/[\s\-\(\)\+]/g, "")}`;

  // "+" before the first digit (possibly after stray symbols, e.g. "?+91 …")
  // means the number is already international.
  const hasPlus = /^[^\d]*\+/.test(clean);

  // Drop separators and stray symbols (spaces, dashes, dots, brackets, commas,
  // slashes, "?"...).
  clean = clean.replace(/\D/g, "");

  // International: "+…" or "00…" (00919876543210, 0014155238886).
  if (hasPlus) return `+${clean}`;
  if (clean.startsWith("00")) return `+${clean.slice(2)}`;

  // National: a trunk "0" (09876543210) or a short number (9876543210,
  // 4155238886) gets the default country code. Longer numbers already
  // carry one (919876543210, 14155238886).
  const cc = String(defaultCountryCode ?? "").replace(/\D/g, "");
  if (clean.startsWith("0")) return `+${cc}${clean.replace(/^0+/, "")}`;
  if (clean.length <= MAX_NATIONAL_DIGITS) return `+${cc}${clean}`;
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
