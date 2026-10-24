const auditService = require("../services/auditService");
const { getContext } = require("../context/requestContext");

// Every change made through the API is audited here, so new routes are
// covered automatically. Sign-in/out are recorded by the auth routes; webhooks
// come from providers, not admins; single chat messages are already stored in
// `messages`.
const SKIP = [/^\/webhooks?(\/|$)/, /^\/auth\//, /^\/(send-message|send-single|send\/single)$/, /^\/campaigns\/preflight$/, /^\/jobs\//];

// Body values that are safe and useful to keep. Everything else is reduced to
// its field name (or the number of items), so message text, phone lists and
// secrets never reach the audit log.
const SAFE_VALUES = new Set(["status", "setName", "label", "campaignName", "templateName", "type", "category", "isImportant", "consent", "ignoreQuietHours", "splitAcrossDays"]);

const summarizeBody = (body) => {
  if (!body || typeof body !== "object") return {};
  const summary = {};
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) summary[key] = `${value.length} item${value.length === 1 ? "" : "s"}`;
    else if (SAFE_VALUES.has(key) && (typeof value !== "object" || value === null)) summary[key] = String(value).slice(0, 120);
    else summary[key] = "(set)";
  }
  return summary;
};

const auditTrail = (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const path = req.path.replace(/^\/api(\/v1)?/, "");
  if (SKIP.some((re) => re.test(path))) return next();

  // Captured now: the response's finish event may run outside this request's context.
  const context = { ...getContext() };
  const [entity = "", maybeId = ""] = path.split("/").filter(Boolean);
  const entityId = /^[0-9a-f-]{36}$/i.test(maybeId) || /^\+?\d{6,15}$/.test(maybeId) ? maybeId : null;

  // Summarised on finish: uploads are parsed later, by the route.
  res.on("finish", () => {
    const details = { body: summarizeBody(req.body), file: req.file ? req.file.originalname : undefined, status: res.statusCode };
    auditService.record(`${req.method} ${path}`, entity, entityId, details, context);
  });
  next();
};

module.exports = auditTrail;
module.exports.summarizeBody = summarizeBody;
