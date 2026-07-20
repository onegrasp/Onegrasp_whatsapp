require("dotenv").config();
const { validateAndFormatE164 } = require("../utils/phone");
const whatsappService = require("../services/whatsappService");
const assert = require("assert");

const runTests = async () => {
  console.log("Executing unit verification tests...");

  // Test 1: Phone format normalization and E.164 validity check
  const check1 = validateAndFormatE164("919999999999");
  assert.strictEqual(check1.isValid, true);
  assert.strictEqual(check1.formatted, "+919999999999");

  const check2 = validateAndFormatE164("+14155238886");
  assert.strictEqual(check2.isValid, true);
  assert.strictEqual(check2.formatted, "+14155238886");

  const check3 = validateAndFormatE164("whatsapp:+14155238886");
  assert.strictEqual(check3.isValid, true);
  assert.strictEqual(check3.formatted, "+14155238886");

  const check4 = validateAndFormatE164("invalid_number_1234");
  assert.strictEqual(check4.isValid, false);

  console.log("✔ Phone number E.164 formatting check passed.");

  // Test 2: Twilio E.164 WhatsApp prefixing helper in whatsappService
  const formatted1 = whatsappService.formatToTwilioPhone("+14155238886");
  assert.strictEqual(formatted1, "whatsapp:+14155238886");

  const formatted2 = whatsappService.formatToTwilioPhone("919876543210");
  assert.strictEqual(formatted2, "whatsapp:+919876543210");

  console.log("✔ whatsappService WhatsApp recipient prefixing passed.");

  console.log("All unit tests run successfully!");
};

runTests().catch((err) => {
  console.error("Verification test failure:", err);
  process.exit(1);
});
