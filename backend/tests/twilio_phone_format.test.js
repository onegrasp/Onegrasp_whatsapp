const test = require("node:test");
const assert = require("node:assert");

const { validateAndFormatE164 } = require("../src/utils/phone");
const twilioService = require("../src/services/twilioService");

test("phone numbers are normalised to E.164", () => {
  assert.deepStrictEqual(
    ["919999999999", "+14155238886", "whatsapp:+14155238886"].map((p) => validateAndFormatE164(p).formatted),
    ["+919999999999", "+14155238886", "+14155238886"]
  );
  assert.strictEqual(validateAndFormatE164("invalid_number_1234").isValid, false);
});

test("Twilio recipients get the whatsapp: prefix", () => {
  assert.strictEqual(twilioService.formatToTwilioPhone("+14155238886"), "whatsapp:+14155238886");
  assert.strictEqual(twilioService.formatToTwilioPhone("919876543210"), "whatsapp:+919876543210");
});
