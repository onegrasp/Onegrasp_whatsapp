// Shared phone number validation and normalization utility (E.164 with + format)

const normalizePhone = (phoneStr, defaultCountryCode = "91") => {
  if (!phoneStr) return "";
  
  // Clean formatting characters, spaces, and 'whatsapp:' prefix
  let clean = String(phoneStr).trim().replace(/^whatsapp:/i, "").replace(/[\s\-\(\)\+]/g, "");
  
  // Strip leading zeroes (e.g., 00918142151161 -> 918142151161, 08142151161 -> 8142151161)
  if (clean.startsWith("00")) {
    clean = clean.slice(2);
  } else if (clean.startsWith("0") && clean.length >= 11) {
    clean = clean.slice(1);
  } else if (clean.startsWith("0") && clean.length === 10) {
    clean = clean.slice(1);
  }

  // If 10 digits starting with 6, 7, 8, or 9 (standard Indian mobile format)
  if (clean.length === 10 && /^[6-9]/.test(clean)) {
    clean = `${defaultCountryCode}${clean}`;
  }
  
  return `+${clean}`;
};

const validateAndFormatE164 = (phoneStr, defaultCountryCode = "91") => {
  if (!phoneStr) return { isValid: false, formatted: "" };
  
  const formatted = normalizePhone(phoneStr, defaultCountryCode);
  
  // E.164 regex: + followed by 8 to 14 digits starting with 1-9
  const regex = /^\+[1-9]\d{7,14}$/;
  
  return {
    isValid: regex.test(formatted),
    formatted,
  };
};

module.exports = {
  normalizePhone,
  validateAndFormatE164,
};
