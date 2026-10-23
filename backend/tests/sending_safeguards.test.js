const test = require("node:test");
const assert = require("node:assert");

const { detectConsentKeyword } = require("../src/utils/keywords");
const { quietHoursEnd } = require("../src/utils/quietHours");
const { mapTwilioError } = require("../src/integrations/twilio/errors");
const { mapMetaError } = require("../src/integrations/meta/errors");
const { assignRunTimes, markQuietHoursOverride, hasQuietHoursOverride } = require("../src/services/sendingPolicy");
const { PERSISTENT_CATEGORIES } = require("../src/workers/retryWorker");

const DAY = 24 * 60 * 60 * 1000;

test("STOP-style replies are detected as opt-outs, whole message only", () => {
  for (const text of ["STOP", "stop", " Stop! ", "Unsubscribe", "STOP ALL", "Stop promotions", "opt-out"]) {
    assert.strictEqual(detectConsentKeyword(text), "opt_out", text);
  }
  assert.strictEqual(detectConsentKeyword("please stop calling me at work"), null);
  assert.strictEqual(detectConsentKeyword("Can you stop by tomorrow?"), null);
});

test("START-style replies are detected as opt-ins", () => {
  assert.strictEqual(detectConsentKeyword("START"), "opt_in");
  assert.strictEqual(detectConsentKeyword("unstop"), "opt_in");
});

test("quick-reply button payloads are checked too", () => {
  assert.strictEqual(detectConsentKeyword("", "Stop promotions", ""), "opt_out");
  assert.strictEqual(detectConsentKeyword("hello", "", ""), null);
});

test("quiet hours across midnight hold messages until the end time (IST)", () => {
  const opts = { enabled: true, start: "21:00", end: "09:00", timeZone: "Asia/Kolkata" };
  // 23:30 IST = 18:00 UTC -> held until 09:00 IST = 03:30 UTC next day
  const night = new Date("2026-10-23T18:00:00Z");
  assert.strictEqual(quietHoursEnd(night, opts).toISOString(), "2026-10-24T03:30:00.000Z");
  // 02:00 IST = 20:30 UTC previous day -> 09:00 IST same day
  const earlyMorning = new Date("2026-10-23T20:30:00Z");
  assert.strictEqual(quietHoursEnd(earlyMorning, opts).toISOString(), "2026-10-24T03:30:00.000Z");
  // 12:00 IST = 06:30 UTC -> not quiet
  assert.strictEqual(quietHoursEnd(new Date("2026-10-23T06:30:00Z"), opts), null);
  // Disabled or invalid settings never block sending
  assert.strictEqual(quietHoursEnd(night, { ...opts, enabled: false }), null);
  assert.strictEqual(quietHoursEnd(night, { ...opts, start: "nonsense" }), null);
  assert.strictEqual(quietHoursEnd(night, { ...opts, timeZone: "Not/AZone" }), null);
});

test("Twilio error codes map to the right handling", () => {
  assert.strictEqual(mapTwilioError({ code: 63018 }).category, "rate_limit");
  assert.strictEqual(mapTwilioError({ code: 63016 }).category, "session_window_expired");
  assert.strictEqual(mapTwilioError({ code: 63049 }).category, "marketing_limit");
  assert.strictEqual(mapTwilioError({ code: 63024 }).category, "invalid_phone");
  assert.strictEqual(mapTwilioError({ code: 63003 }).category, "invalid_phone");
  assert.strictEqual(mapTwilioError({ code: 63015 }).category, "sandbox_not_joined");
  assert.strictEqual(mapTwilioError({ code: 63112 }).category, "account_restricted");
  assert.match(mapTwilioError({ code: "63049" }).message, /Meta held back/);
});

test("Meta error codes map to the right handling", () => {
  assert.strictEqual(mapMetaError({ code: 131049, message: "x" }).category, "marketing_limit");
  assert.strictEqual(mapMetaError({ code: 131056, message: "x" }).category, "rate_limit");
  assert.strictEqual(mapMetaError({ code: 131048, message: "x" }).category, "account_restricted");
});

test("marketing holds and account problems are never retried quickly", () => {
  for (const category of ["marketing_limit", "account_restricted", "policy_violation", "invalid_phone", "opt_out"]) {
    assert.ok(PERSISTENT_CATEGORIES.has(category), category);
  }
  assert.ok(!PERSISTENT_CATEGORIES.has("rate_limit"), "rate limits should back off and retry");
});

test("'Send now anyway' exempts only that campaign from quiet hours", () => {
  assert.strictEqual(hasQuietHoursOverride({ id: "c-normal" }), false);
  assert.strictEqual(hasQuietHoursOverride({ id: "c-db", ignore_quiet_hours: true }), true);
  markQuietHoursOverride("c-urgent");
  assert.strictEqual(hasQuietHoursOverride({ id: "c-urgent" }), true);
  assert.strictEqual(hasQuietHoursOverride({ id: "c-normal" }), false);
  assert.strictEqual(hasQuietHoursOverride(null), false);
});

test("daily-limit splitting sends what fits today and the rest in daily batches", () => {
  const start = new Date("2026-10-23T05:00:00Z");
  const times = assignRunTimes(7, { start, limit: 3, remaining: 2, split: true }).map((d) => d.getTime() - start.getTime());
  assert.deepStrictEqual(times, [0, 0, DAY, DAY, DAY, 2 * DAY, 2 * DAY]);

  const unsplit = assignRunTimes(3, { start, limit: 3, remaining: 0, split: false });
  assert.ok(unsplit.every((d) => d.getTime() === start.getTime()));
});
