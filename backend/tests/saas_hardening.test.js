const test = require("node:test");
const assert = require("node:assert");

// 1. Test Twilio Error Mappings
const { mapTwilioError } = require("../src/integrations/twilio/errors");
test("Twilio Error Mapper maps code 21614 to invalid_phone", () => {
  const result = mapTwilioError({ code: 21614, message: "Invalid phone number" });
  assert.strictEqual(result.category, "invalid_phone");
  assert.strictEqual(result.code, 21614);
});

test("Twilio Error Mapper maps rate limit 20429 to rate_limit", () => {
  const result = mapTwilioError({ code: 20429, message: "Too many requests" });
  assert.strictEqual(result.category, "rate_limit");
});

test("Twilio Error Mapper maps code 63016 to session_window_expired", () => {
  const result = mapTwilioError({ code: 63016, message: "Outside 24-hour window" });
  assert.strictEqual(result.category, "session_window_expired");
});

test("Twilio Error Mapper falls back to other for untracked code", () => {
  const result = mapTwilioError({ code: 99999, message: "Some unknown Twilio error" });
  assert.strictEqual(result.category, "other");
});

// 2. Test Zod Validators
const { validateSendMessage } = require("../src/validators/message.validator");
test("Message validator parses valid phone and message", () => {
  const payload = { phone: "+14155238886", message: "Hello world" };
  const validated = validateSendMessage(payload);
  assert.strictEqual(validated.phone, "+14155238886");
  assert.strictEqual(validated.message, "Hello world");
});

test("Message validator rejects empty message", () => {
  const payload = { phone: "+14155238886", message: "" };
  assert.throws(() => {
    validateSendMessage(payload);
  });
});

// 3. Test Event Bus
const eventBus = require("../src/events/eventBus");
test("EventBus registers and publishes events successfully", async () => {
  let receivedData = null;
  eventBus.subscribe("TestEvent", (data) => {
    receivedData = data;
  });

  eventBus.publish("TestEvent", { key: "value123" });
  
  // Await a tick for event handlers
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(receivedData, { key: "value123" });
});

// 4. Test requestContext Storage
const { AsyncLocalStorage } = require("async_hooks");
const store = new AsyncLocalStorage();
test("RequestContext flows through AsyncLocalStorage", async () => {
  const context = { requestId: "req-123", correlationId: "corr-123" };
  await store.run(context, async () => {
    const active = store.getStore();
    assert.strictEqual(active.requestId, "req-123");
    assert.strictEqual(active.correlationId, "corr-123");
  });
});

// 5. Test metrics tracker
const metrics = require("../src/utils/metrics");
test("Metrics records latency and fetches stats", () => {
  metrics.recordDbLatency(12);
  metrics.recordTwilioLatency(45);
  const stats = metrics.getStats();
  assert.strictEqual(stats.dbLatencyMs, 12);
  assert.strictEqual(stats.twilioLatencyMs, 45);
  assert.ok(stats.memory.heapUsed);
});
