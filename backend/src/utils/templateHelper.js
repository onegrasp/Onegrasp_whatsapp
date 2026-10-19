const templateRepository = require("../repositories/templateRepository");
const logger = require("./logger");

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

async function lookupTemplate(templateName) {
  if (!templateName) return null;

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateName);
    if (isUuid) {
      return await templateRepository.findById(templateName);
    }

    let tpl = await templateRepository.findByName(templateName);
    if (!tpl) tpl = await templateRepository.findByContentSid(templateName);
    if (!tpl) tpl = await templateRepository.findById(templateName);
    return tpl;
  } catch (e) {
    logger.warn("Could not lookup template:", { templateName, error: e.message });
    return null;
  }
}

/**
 * Pick the identifier and language to send for the active provider.
 * Meta: approved template *name* + language code (never Twilio HX Content SID).
 * Twilio: prefer Content SID when available.
 */
async function resolveTemplateSendTarget(templateName, provider) {
  const tpl = await lookupTemplate(templateName);
  const language = (tpl && tpl.language) ? String(tpl.language) : "en";

  if (provider === "meta") {
    const metaName = tpl?.name || (templateName && !String(templateName).startsWith("HX") ? templateName : "");
    return { sendName: metaName || templateName, language, tpl };
  }

  if (provider === "twilio") {
    if (tpl?.content_sid && String(tpl.content_sid).startsWith("HX")) {
      return { sendName: tpl.content_sid, language, tpl };
    }
    if (templateName && String(templateName).startsWith("HX")) {
      return { sendName: templateName, language, tpl };
    }
    return { sendName: tpl?.name || templateName, language, tpl };
  }

  return { sendName: templateName, language, tpl };
}

/**
 * Resolve template body text by substituting parameters (UI / logs / Twilio body fallback only).
 *
 * `renderedFallback` is the message the caller has already rendered for this
 * recipient. When it is a complete string (no unresolved {{placeholders}} and
 * not a Twilio Content SID) it is delivered verbatim — this is the normal case
 * for UI and queued sends, and returning it untouched is what prevents the
 * silent truncation that used to occur when the stored template body was
 * re-derived and any placeholder that could not be mapped was deleted.
 */
async function resolveTemplateText(templateName, params = [], renderedFallback = "") {
  const fallback = String(renderedFallback || "");
  const fallbackIsHx = fallback.startsWith("HX");
  const fallbackHasPlaceholders = /\{\{[^}]+\}\}/.test(fallback);

  if (!templateName && !fallback) {
    return "";
  }

  // 1. Already-rendered caller text with no leftover placeholders → deliver as-is.
  if (fallback && !fallbackIsHx && !fallbackHasPlaceholders) {
    return fallback;
  }

  // 2. Otherwise pick a body to substitute into: stored template body first.
  let bodyText = "";

  try {
    const tpl = await lookupTemplate(templateName);
    if (tpl && tpl.body && !String(tpl.body).startsWith("HX")) {
      bodyText = tpl.body;
    }
  } catch (e) {
    logger.warn("Could not query template repository for resolution:", { error: e.message });
  }

  // 3. Fall back to the live Twilio Content body only when the identifier is an
  //    HX SID. The Twilio client is instantiated lazily inside this guard so a
  //    plain-name or fallback-only resolution never makes a network round-trip.
  if ((!bodyText || bodyText.startsWith("HX")) && templateName && String(templateName).startsWith("HX")) {
    try {
      const { getTwilioClient } = require("../integrations/twilio/client");
      const client = await getTwilioClient();
      if (client.content) {
        const contentInfo = await client.content.v1.contents(templateName).fetch().catch(() => null);
        if (contentInfo && contentInfo.types) {
          const typeObj = Object.values(contentInfo.types)[0];
          if (typeObj && typeObj.body) {
            bodyText = typeObj.body;
          }
        }
      }
    } catch (apiErr) {
      // ignore
    }
  }

  // 4. Last resort: substitute into the caller-provided fallback template text.
  if (!bodyText || bodyText.startsWith("HX")) {
    bodyText = fallback && !fallbackIsHx ? fallback : "";
  }

  if (!bodyText) {
    return `[Template: ${templateName}]`;
  }

  const paramArray = Array.isArray(params)
    ? params
    : (typeof params === "object" && params !== null ? Object.values(params) : []);

  paramArray.forEach((p, index) => {
    const val = sanitizeVariableValue(p);
    bodyText = bodyText.replace(new RegExp(`\\{\\{\\s*${index + 1}\\s*\\}\\}`, "g"), val);
  });

  if (paramArray.length > 0) {
    const firstVal = sanitizeVariableValue(paramArray[0]);
    bodyText = bodyText
      .replace(/\{\{\s*(name|contact_name|customer_name|recipient_name)\s*\}\}/gi, firstVal);
  }

  // Remove only the placeholders we genuinely could not resolve, keeping the
  // surrounding words intact rather than cutting the message short.
  bodyText = bodyText.replace(/\{\{[^}]+\}\}/g, "").trim();

  return bodyText;
}

module.exports = {
  resolveTemplateText,
  resolveTemplateSendTarget,
  lookupTemplate,
  extractTemplatePlaceholders,
  sanitizeVariableValue,
  validateTemplateParameters,
};
