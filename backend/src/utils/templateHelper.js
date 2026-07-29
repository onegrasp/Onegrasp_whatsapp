const templateRepository = require("../repositories/templateRepository");

async function resolveTemplateText(templateName, params = [], defaultFallback = "") {
  if (!templateName) return defaultFallback || "Welcome to OneGrasp!";

  let bodyText = "";

  try {
    let tpl = await templateRepository.findByContentSid(templateName);
    if (!tpl) tpl = await templateRepository.findByName(templateName);
    if (!tpl) tpl = await templateRepository.findById(templateName);

    if (tpl && tpl.body && !tpl.body.startsWith("HX")) {
      bodyText = tpl.body;
    }
  } catch (e) {}

  if (!bodyText || bodyText.startsWith("HX")) {
    try {
      const { getTwilioClient } = require("../integrations/twilio/client");
      const client = await getTwilioClient();
      if (templateName.startsWith("HX")) {
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
    bodyText = (defaultFallback && !defaultFallback.startsWith("HX")) ? defaultFallback : "Hello {{name}},\nWelcome to OneGrasp!";
  }

  // Substitute parameters
  const paramArray = Array.isArray(params) ? params : (typeof params === "object" && params !== null ? Object.values(params) : []);
  if (paramArray.length > 0) {
    paramArray.forEach((p, index) => {
      const val = String(p || "").trim();
      if (val) {
        bodyText = bodyText
          .replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), val)
          .replace(/\{\{(name|contact_name|customer_name|recipient_name)\}\}/gi, val);
      }
    });
  }

  // Fail-safe cleanup: Replace any remaining unreplaced {{1}}, {{name}}, {{contact_name}} placeholders with 'Valued Customer'
  bodyText = bodyText
    .replace(/\{\{(1|name|contact_name|customer_name|recipient_name)\}\}/gi, "Valued Customer")
    .replace(/\{\{(phone|contact_phone|mobile|number)\}\}/gi, "");

  return bodyText.trim();
}

module.exports = { resolveTemplateText };
