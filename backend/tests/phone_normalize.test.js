const test = require("node:test");
const assert = require("node:assert");

const { normalizePhone, validateAndFormatE164, applyCountryCode } = require("../src/utils/phone");

test("bare national numbers get the default country code (India)", () => {
  assert.strictEqual(normalizePhone("9876543210", "91"), "+919876543210");
  assert.strictEqual(normalizePhone("98765 43210", "91"), "+919876543210");
  assert.strictEqual(normalizePhone("09876543210", "91"), "+919876543210");
});

test("bare national numbers get the default country code (US/Canada)", () => {
  assert.strictEqual(normalizePhone("4155238886", "1"), "+14155238886");
  assert.strictEqual(normalizePhone("(202) 555-0123", "1"), "+12025550123");
  assert.deepStrictEqual(validateAndFormatE164("4155238886", "1"), { isValid: true, formatted: "+14155238886" });
  // The default may be written with a "+".
  assert.strictEqual(normalizePhone("4155238886", "+1"), "+14155238886");
});

test("a bare 10-digit number never becomes a different country's number", () => {
  // Previously "+4155238886" (Switzerland) and "+2025550123" (Egypt).
  assert.strictEqual(normalizePhone("4155238886", "91"), "+914155238886");
  assert.strictEqual(normalizePhone("2025550123", "1"), "+12025550123");
  assert.notStrictEqual(validateAndFormatE164("4155238886", "1").formatted, "+4155238886");
});

test("international numbers are kept as they are (no second country code)", () => {
  for (const cc of ["91", "1"]) {
    assert.strictEqual(normalizePhone("+14155238886", cc), "+14155238886");
    assert.strictEqual(normalizePhone("0014155238886", cc), "+14155238886");
    assert.strictEqual(normalizePhone("00919876543210", cc), "+919876543210");
    assert.strictEqual(normalizePhone("+91 98765 43210", cc), "+919876543210");
    assert.strictEqual(normalizePhone("whatsapp:+14155238886", cc), "+14155238886");
    assert.strictEqual(normalizePhone("?+91 98765-43210", cc), "+919876543210");
    // Already prefixed but without "+": longer than a national number.
    assert.strictEqual(normalizePhone("919876543210", cc), "+919876543210");
    assert.strictEqual(normalizePhone("14155238886", cc), "+14155238886");
  }
});

test("a separate country code (import column) still works as before", () => {
  assert.strictEqual(applyCountryCode("1", "4155238886"), "+14155238886");
  assert.strictEqual(normalizePhone(applyCountryCode("1", "4155238886"), "91"), "+14155238886");
  assert.strictEqual(normalizePhone(applyCountryCode("91", "919876543210"), "1"), "+919876543210");
});

test("invalid input stays invalid", () => {
  assert.strictEqual(validateAndFormatE164("123", "91").isValid, false);
  assert.strictEqual(validateAndFormatE164("abc", "91").isValid, false);
  assert.strictEqual(validateAndFormatE164("", "91").isValid, false);
});
