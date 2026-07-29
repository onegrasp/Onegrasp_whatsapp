const templateRepository = require("../repositories/templateRepository");

async function resolveTemplateText(templateName, params = [], defaultFallback = "") {
  if (!templateName) return defaultFallback;

  let bodyText = defaultFallback;

  try {
    let tpl = await templateRepository.findByContentSid(templateName);
    if (!tpl) tpl = await templateRepository.findByName(templateName);
    if (!tpl) tpl = await templateRepository.findById(templateName);

    if (tpl && tpl.body) {
      bodyText = tpl.body;
    }
  } catch (e) {}

  if (!bodyText || bodyText.startsWith("HX")) {
    bodyText = defaultFallback || templateName;
  }

  // Replace placeholders like {{1}}, {{name}}, {{contact_name}}, etc.
  const paramArray = Array.isArray(params) ? params : (typeof params === "object" && params !== null ? Object.values(params) : []);
  if (paramArray.length > 0) {
    paramArray.forEach((p, index) => {
      const val = String(p || "");
      bodyText = bodyText
        .replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), val)
        .replace(/\{\{(name|contact_name|customer_name|recipient_name)\}\}/gi, val);
    });
  }

  return bodyText;
}

module.exports = { resolveTemplateText };
