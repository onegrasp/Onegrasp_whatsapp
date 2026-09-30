const test = require("node:test");
const assert = require("node:assert");

const { mapMetaError } = require("../src/integrations/meta/errors");
const metaMessagingService = require("../src/integrations/meta/messaging.service");
const {
  validateTemplateParameters,
  sanitizeVariableValue,
  resolveTemplateText,
  extractTemplatePlaceholders,
} = require("../src/utils/templateHelper");
const { scheduleRetry } = require("../src/workers/retryWorker");

// 1. Meta Error Mapper Tests
test("Meta Error Mapper maps 131047 to session_window_expired", () => {
  const result = mapMetaError({ error: { code: 131047, message: "Re-engagement message outside 24h window" } });
  assert.strictEqual(result.category, "session_window_expired");
  assert.strictEqual(result.code, 131047);
});

test("Meta Error Mapper maps 132001 to template_param_mismatch", () => {
  const result = mapMetaError({ error: { code: 132001, message: "Template parameters count mismatch" } });
  assert.strictEqual(result.category, "template_param_mismatch");
});

test("Meta Error Mapper maps 130429 to rate_limit", () => {
  const result = mapMetaError({ error: { code: 130429, message: "Rate limit hit" } });
  assert.strictEqual(result.category, "rate_limit");
});

test("Meta Error Mapper maps 131008 to invalid_phone", () => {
  const result = mapMetaError({ error: { code: 131008, message: "Recipient number is not a valid WhatsApp user" } });
  assert.strictEqual(result.category, "invalid_phone");
});

// 2. Template Variable Sanitization & Length Limit Tests
test("sanitizeVariableValue strips line breaks, null bytes, and trims spaces", () => {
  const input = "  John\r\nDoe\0 \t ";
  const cleaned = sanitizeVariableValue(input);
  assert.strictEqual(cleaned, "John Doe");
});

test("sanitizeVariableValue prevents empty string output by returning space", () => {
  assert.strictEqual(sanitizeVariableValue(""), " ");
  assert.strictEqual(sanitizeVariableValue(null), " ");
  assert.strictEqual(sanitizeVariableValue(undefined), " ");
});

test("validateTemplateParameters catches parameter count mismatch", () => {
  const tpl = "Hello {{1}}, your order {{2}} has been confirmed for {{3}}.";
  const valResult = validateTemplateParameters(tpl, ["John", "ORD123"]); // only 2 provided instead of 3
  assert.strictEqual(valResult.isValid, false);
  assert.ok(valResult.error.includes("Template parameter count mismatch"));
});

test("validateTemplateParameters accepts exact parameter count", () => {
  const tpl = "Hello {{1}}, your order {{2}} has been confirmed.";
  const valResult = validateTemplateParameters(tpl, ["John", "ORD123"]);
  assert.strictEqual(valResult.isValid, true);
  assert.strictEqual(valResult.error, null);
});

test("validateTemplateParameters catches overall body length > 1024 bytes", () => {
  const tpl = "Hello {{1}}";
  const giantParam = "A".repeat(1025);
  const valResult = validateTemplateParameters(tpl, [giantParam]);
  assert.strictEqual(valResult.isValid, false);
  assert.ok(valResult.error.includes("exceeds Meta WhatsApp API maximum limit"));
});

// 3. Template Text Resolution Tests
test("resolveTemplateText correctly replaces {{1}}, {{2}} and clears unreplaced tags", async () => {
  const tplName = "promo_test";
  const text = await resolveTemplateText(tplName, ["Alice", "50% OFF"], "Hello {{1}}, get {{2}} now!");
  assert.strictEqual(text, "Hello Alice, get 50% OFF now!");
});

test("resolveTemplateText cleans unreplaced placeholders safely", async () => {
  const text = await resolveTemplateText("test_tpl", [], "Hello {{1}}, welcome {{2}}!");
  assert.strictEqual(text, "Hello , welcome !");
});

// 4. Rate Limit Backoff Schedule Test
test("scheduleRetry applies exponential backoff for rate_limit errors", async () => {
  const jobMock = {
    id: "job-123",
    phone: "+919876543210",
    attempts: 1,
    max_attempts: 5,
    message: "Test msg",
    type: "text",
  };
  const rateLimitErr = new Error("Rate limit 130429");
  rateLimitErr.category = "rate_limit";

  const result = await scheduleRetry(jobMock, rateLimitErr);
  assert.strictEqual(result.type, "rescheduled");
  assert.ok(result.retryTime);
});
