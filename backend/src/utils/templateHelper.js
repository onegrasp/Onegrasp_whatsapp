const templateRepository = require("../repositories/templateRepository");
const logger = require("./logger");

const WORKSHOP_TEXT_MATTER = `What if ₹599 could give you access to ₹30,000+ worth of academic writing benefits?\nGET TOTAL WORTH OF ₹30,000+ with REGISTRATION at ₹599 ONLY\n\n📅 25 September 2026\n⏰ 7 PM – 10 PM IST\n⏳ Register by 15 September`;

/**
 * Extract all variable placeholders {{1}}, {{2}}... or {{name}} from template body
 */
function extractTemplatePlaceholders(bodyText) {
  if (!bodyText) return [];
  const regex = /\{\{(\d+|\w+)\}\}/g;
  const placeholders = [];
  let match;
  while ((match = regex.exec(bodyText)) !== null) {
    if (!placeholders.includes(match[1])) {
      placeholders.push(match[1]);
    }
  }
  return placeholders;
}

/**
 * Sanitize variable value according to Meta Cloud API constraints:
 * - Strip null bytes \0
 * - Replace unescaped newlines/tabs with space (Meta parameters cannot contain line breaks)
 * - Trim leading/trailing whitespace
 * - Prevent empty string (Meta requires non-empty parameter strings)
 * - Enforce UTF-8 byte length limits (max 1024 bytes per variable)
 */
function sanitizeVariableValue(val) {
  if (val === null || val === undefined) return " ";
  let str = String(val).replace(/\0/g, "").replace(/[\r\n\t]+/g, " ").trim();
  if (!str) str = " ";

  const buf = Buffer.from(str, "utf8");
  if (buf.length > 1024) {
    str = buf.subarray(0, 1024).toString("utf8").replace(/[\uFFFD]/g, "");
  }
  return str;
}

/**
 * Validate variable parameters against expected Meta template placeholders
 */
function validateTemplateParameters(templateBody, params = []) {
  const placeholders = extractTemplatePlaceholders(templateBody);
  const paramArray = Array.isArray(params)
    ? params
    : (typeof params === "object" && params !== null ? Object.values(params) : []);

  const expectedCount = placeholders.length;
  const providedCount = paramArray.length;

  const sanitizedParams = paramArray.map(sanitizeVariableValue);

  if (expectedCount !== providedCount) {
    return {
      isValid: false,
      error: `Template parameter count mismatch: template requires ${expectedCount} variable(s) [${placeholders.map((p) => `{{${p}}}`).join(", ")}], but ${providedCount} parameter(s) were supplied.`,
      expectedCount,
      providedCount,
      sanitizedParams,
    };
  }

  // Check overall body length limit (max 1024 UTF-8 bytes after substitution)
  let testBody = templateBody || "";
  placeholders.forEach((ph, idx) => {
    const val = sanitizedParams[idx] || " ";
    testBody = testBody.replace(new RegExp(`\\{\\{${ph}\\}\\}`, "g"), val);
  });

  const totalBytes = Buffer.byteLength(testBody, "utf8");
  if (totalBytes > 1024) {
    return {
      isValid: false,
      error: `Substituted body length (${totalBytes} bytes) exceeds Meta WhatsApp API maximum limit of 1024 UTF-8 bytes.`,
      expectedCount,
      providedCount,
      sanitizedParams,
    };
  }

  return {
    isValid: true,
    error: null,
    expectedCount,
    providedCount,
    sanitizedParams,
  };
}

/**
 * Resolve template body text by substituting parameters accurately
 */
async function resolveTemplateText(templateName, params = [], defaultFallback = "") {
  if (!templateName) return defaultFallback || WORKSHOP_TEXT_MATTER;

  let bodyText = "";

  try {
    let tpl = await templateRepository.findByContentSid(templateName);
    if (!tpl) tpl = await templateRepository.findByName(templateName);
    if (!tpl) tpl = await templateRepository.findById(templateName);

    if (tpl && tpl.body && !tpl.body.startsWith("HX")) {
      bodyText = tpl.body;
    }
  } catch (e) {
    logger.warn("Could not query template repository for resolution:", { error: e.message });
  }

  if (!bodyText || bodyText.startsWith("HX")) {
    try {
      const { getTwilioClient } = require("../integrations/twilio/client");
      const client = await getTwilioClient();
      if (templateName.startsWith("HX") && client.content) {
        const contentInfo = await client.content.v1.contents(templateName).fetch().catch(() => null);
        if (contentInfo && contentInfo.types) {
          const typeObj = Object.values(contentInfo.types)[0];
          if (typeObj && typeObj.body) {
            bodyText = typeObj.body;
          }
        }
      }
    } catch (apiErr) {}
  }

  if (!bodyText || bodyText.startsWith("HX")) {
    bodyText = (defaultFallback && !defaultFallback.startsWith("HX"))
      ? defaultFallback
      : WORKSHOP_TEXT_MATTER;
  }

  const paramArray = Array.isArray(params)
    ? params
    : (typeof params === "object" && params !== null ? Object.values(params) : []);

  // 1. Position-based substitution: {{1}}, {{2}}, {{3}}... {{N}}
  paramArray.forEach((p, index) => {
    const val = sanitizeVariableValue(p);
    bodyText = bodyText.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), val);
  });

  // 2. Named placeholder substitution: {{name}}, {{contact_name}}, {{customer_name}}, {{phone}}, etc.
  if (paramArray.length > 0) {
    const firstVal = sanitizeVariableValue(paramArray[0]);
    bodyText = bodyText
      .replace(/\{\{(name|contact_name|customer_name|recipient_name)\}\}/gi, firstVal);
  }

  // 3. Fail-safe cleanup: Replace ANY remaining unreplaced {{...}} placeholders with a space
  bodyText = bodyText.replace(/\{\{(\d+|\w+)\}\}/g, "").trim();

  return bodyText;
}

module.exports = {
  resolveTemplateText,
  extractTemplatePlaceholders,
  sanitizeVariableValue,
  validateTemplateParameters,
};
