const test = require("node:test");
const assert = require("node:assert");
const XLSX = require("xlsx");

const { parseContactsFile, readPhoneCell } = require("../src/utils/csvParser");
const { normalizePhone, applyCountryCode } = require("../src/utils/phone");
const { isStatusRegression } = require("../src/events/handlers");

const csv = (text) => Buffer.from(text, "utf-8");

test("scientific-notation numbers that lost digits are rejected, not imported as ...000000", () => {
  // The exact corrupted values seen in production: 9.2E+11 -> +920000000000 etc.
  for (const value of ["9.2E+11", "9.19E+11", "9.1995E+11", "9.19441E+11"]) {
    const { error } = readPhoneCell(value);
    assert.match(error, /scientific notation/i, `${value} should be rejected`);
  }
});

test("scientific notation with every digit present is still accepted", () => {
  assert.deepStrictEqual(readPhoneCell("9.19876543210E+11"), { value: "919876543210" });
});

test("numeric cells already rounded by Excel are rejected", () => {
  assert.match(readPhoneCell(919441000000).error, /rounded/i);
  assert.deepStrictEqual(readPhoneCell(919876543210), { value: "919876543210" });
});

test("stray symbols and invisible characters are stripped from numbers", () => {
  assert.strictEqual(normalizePhone("?+91 98765-43210"), "+919876543210");
  assert.strictEqual(normalizePhone("919,876,543,210"), "+919876543210");
  assert.strictEqual(normalizePhone("\u202A+91.98765.43210\u202C"), "+919876543210");
  assert.strictEqual(normalizePhone("whatsapp:+14155238886"), "+14155238886");
});

test("values with letters stay invalid", () => {
  assert.strictEqual(normalizePhone("abc"), "+abc");
});

test("a separate country code is applied only to local numbers", () => {
  assert.strictEqual(applyCountryCode("91", "9876543210"), "+919876543210");
  assert.strictEqual(applyCountryCode("+91", "09876543210"), "+919876543210");
  assert.strictEqual(applyCountryCode("91", "919876543210"), "+919876543210");
  assert.strictEqual(applyCountryCode("1", "4155238886"), "+14155238886");
  assert.strictEqual(applyCountryCode("91", "+14155238886"), "+14155238886");
  assert.strictEqual(applyCountryCode("", "9876543210"), "9876543210");
});

test("CSV import reports every rejected row with its row number and reason", async () => {
  const { contacts, issues, totalRows } = await parseContactsFile(csv(
    [
      "Name,Country Code,Phone",
      "Asha,91,9876543210",
      "Ben,1,4155238886",
      "Asha again,91,98765 43210",
      "Bella,,9.2E+11",
      "No Phone,91,",
      "Short,91,123",
      "Two numbers,91,9876500001 / 9876500002",
    ].join("\n")
  ));

  assert.strictEqual(totalRows, 7);
  assert.deepStrictEqual(contacts.map((c) => c.phone), ["+919876543210", "+14155238886", "+919876500001"]);
  assert.strictEqual(contacts[0].name, "Asha");

  const byRow = Object.fromEntries(issues.map((i) => [i.row, i]));
  assert.strictEqual(byRow[4].type, "duplicate");
  assert.match(byRow[4].reason, /row 2/);
  assert.strictEqual(byRow[5].type, "invalid");
  assert.match(byRow[5].reason, /scientific notation/i);
  assert.match(byRow[6].reason, /missing/i);
  assert.match(byRow[7].reason, /too short/i);
  assert.strictEqual(byRow[8].type, "warning");
});

test("semicolon CSV and First/Last name columns are supported", async () => {
  const { contacts } = await parseContactsFile(csv("First Name;Last Name;Mobile No\nJohn;Doe;+44 7911 123456\n"));
  assert.deepStrictEqual(contacts, [{ phone: "+447911123456", name: "John Doe", row: 2 }]);
});

test("headerless files are detected by their phone-like column", async () => {
  const { contacts } = await parseContactsFile(csv("Ravi,9876543210\nMeena,9123456789\n"));
  assert.deepStrictEqual(contacts.map((c) => [c.name, c.phone]), [
    ["Ravi", "+919876543210"],
    ["Meena", "+919123456789"],
  ]);
});

test(".xlsx files with numeric phone cells import exactly", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([["Name", "Phone"], ["Kiran", 919876543210]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Contacts");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

  const { contacts, issues } = await parseContactsFile(buffer);
  assert.deepStrictEqual(contacts.map((c) => c.phone), ["+919876543210"]);
  assert.strictEqual(issues.length, 0);
});

test("delivery status never moves backwards", () => {
  assert.strictEqual(isStatusRegression("read", "delivered"), true);
  assert.strictEqual(isStatusRegression("delivered", "sent"), true);
  assert.strictEqual(isStatusRegression("read", "failed"), true);
  assert.strictEqual(isStatusRegression("sent", "delivered"), false);
  assert.strictEqual(isStatusRegression("delivered", "read"), false);
  assert.strictEqual(isStatusRegression("sent", "undelivered"), false);
  assert.strictEqual(isStatusRegression(undefined, "sent"), false);
});
