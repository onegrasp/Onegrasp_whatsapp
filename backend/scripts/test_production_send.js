require("dotenv").config();
const messagingService = require("../src/integrations/twilio/messaging.service");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Enter your personal phone number to receive the test WhatsApp message (e.g., +919876543210): ", async (recipient) => {
  if (!recipient.trim()) {
    console.error("Recipient phone number is required.");
    rl.close();
    process.exit(1);
  }

  console.log(`\nInitiating production message dispatch to: ${recipient}...`);

  try {
    const result = await messagingService.sendText(
      recipient,
      "Hello! This is a production test message from your newly refactored WhatsApp Bulk Messaging platform."
    );
    console.log("\n✅ Dispatch Success!");
    console.log(`- Twilio Message SID: ${result.sid}`);
    console.log("- Status: Sent / Queued");
  } catch (err) {
    console.error("\n❌ Send Failed with Twilio Exception:");
    console.error(`- Error Code: ${err.code || "unknown"}`);
    console.error(`- Category: ${err.category || "other"}`);
    console.error(`- Reason: ${err.message}`);
  } finally {
    rl.close();
  }
});
