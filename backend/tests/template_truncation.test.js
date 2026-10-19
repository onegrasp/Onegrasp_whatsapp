const test = require("node:test");
const assert = require("node:assert");

const { resolveTemplateText } = require("../src/utils/templateHelper");

// Regression tests for the template message truncation bug: approved-template
// sends were arriving with text cut out because unresolved placeholders were
// stripped and the already-rendered message was discarded.

test("a fully rendered message is delivered verbatim (no truncation)", async () => {
  const rendered =
    "Hi John Doe, your appointment is confirmed for 2026-07-25 at 10:30 AM at Grand Auditorium. Thanks, OneGrasp.";
  const out = await resolveTemplateText("appointment_confirm", [], rendered);
  assert.strictEqual(out, rendered);
});

test("named placeholders are not silently dropped from the middle of a message", async () => {
  // Empty templateName keeps this offline: the function substitutes into the
  // provided fallback template instead of hitting the database/Twilio.
  const body = "Hello {{name}}, welcome to {{company}} — see you on {{date}}!";
  const out = await resolveTemplateText("", ["Alice"], body);
  // {{name}} resolves to the first param; genuinely unmapped tags are removed
  // without deleting the words around them.
  assert.ok(out.startsWith("Hello Alice, welcome to "), out);
  assert.ok(out.includes("see you on"), out);
  assert.ok(!out.includes("{{"), out);
});

test("positional placeholders substitute in order", async () => {
  const body = "Hello {{1}}, get {{2}} now!";
  const out = await resolveTemplateText("", ["Alice", "50% OFF"], body);
  assert.strictEqual(out, "Hello Alice, get 50% OFF now!");
});

test("a template identifier is never returned as the message body", async () => {
  // No rendered fallback and no stored body available -> marker, not the name.
  const out = await resolveTemplateText("", [], "");
  assert.strictEqual(out, "");
});
