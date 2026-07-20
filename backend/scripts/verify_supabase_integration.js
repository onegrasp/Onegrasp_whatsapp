require("dotenv").config();
const { validateAndFormatE164 } = require("../utils/phone");
const assert = require("assert");

const runTests = async () => {
  console.log("Executing Supabase-refactored unit verification tests...");

  // Test 1: Phone number formatter
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

  // Test 2: Verify Supabase environment configuration
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("⚠️ SUPABASE_URL or SUPABASE_KEY is missing from environment. Skipping client initialization check.");
  } else {
    try {
      const supabase = require("../utils/supabase");
      assert.ok(supabase);
      console.log("✔ Supabase client initialized successfully.");
    } catch (err) {
      console.error("❌ Failed to initialize Supabase client:", err);
      process.exit(1);
    }
  }

  console.log("All unit tests run successfully!");
};

runTests().catch((err) => {
  console.error("Verification test failure:", err);
  process.exit(1);
});
