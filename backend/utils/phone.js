// Shared phone number validation and normalization utility (E.164 with + format)

const normalizePhone = (phoneStr) => {
  if (!phoneStr) return "";
  
  // Clean formatting characters, spaces, and 'whatsapp:' prefix
  let clean = phoneStr.trim().replace(/^whatsapp:/i, "").replace(/[\s\-\(\)\+]/g, "");
  
  // Prepend '+' prefix to match E.164 canonical format
  return `+${clean}`;
};

const validateAndFormatE164 = (phoneStr) => {
  if (!phoneStr) return { isValid: false, formatted: "" };
  
  const formatted = normalizePhone(phoneStr);
  
  // E.164 regex: + followed by 1 to 14 digits
  const regex = /^\+[1-9]\d{1,14}$/;
  
  return {
    isValid: regex.test(formatted),
    formatted,
  };
};

module.exports = {
  normalizePhone,
  validateAndFormatE164,
};
