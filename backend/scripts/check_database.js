const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("dotenv").config(); // Fallback for root .env if present

const supabase = require("../src/config/supabase");

async function checkDatabase() {
  console.log("=================================================");
  console.log(" 🔍 SUPABASE DATABASE HEALTH & DATA INTEGRITY CHECK");
  console.log("=================================================\n");

  const startTime = Date.now();
  let overallSuccess = true;

  const tablesToCheck = [
    { name: "contacts", desc: "Contact Records & Phone Numbers" },
    { name: "templates", desc: "WhatsApp Message Templates" },
    { name: "campaigns", desc: "Bulk Campaign Execution History" },
    { name: "messages", desc: "Individual Outbound/Inbound Messages" },
    { name: "conversations", desc: "Active Chat Conversation Threads" },
    { name: "audit_logs", desc: "System Audit Logs & Event History" },
    { name: "opt_outs", desc: "Unsubscribed / Opted-Out Phone Numbers" },
    { name: "media_assets", desc: "Uploaded Header & Campaign Media Files" },
    { name: "settings", desc: "Global Application Settings" },
  ];

  const results = [];

  for (const t of tablesToCheck) {
    try {
      const tStart = Date.now();
      const { data, count, error } = await supabase
        .from(t.name)
        .select("*", { count: "exact", head: false })
        .limit(3);

      const latency = Date.now() - tStart;

      if (error) {
        overallSuccess = false;
        results.push({
          Table: t.name,
          Status: "❌ ERROR",
          "Record Count": 0,
          "Latency (ms)": `${latency}ms`,
          Details: error.message || JSON.stringify(error),
        });
      } else {
        results.push({
          Table: t.name,
          Status: "✅ Healthy",
          "Record Count": count ?? (data ? data.length : 0),
          "Latency (ms)": `${latency}ms`,
          Details: `${data ? data.length : 0} sample rows fetched cleanly`,
        });
      }
    } catch (err) {
      overallSuccess = false;
      results.push({
        Table: t.name,
        Status: "❌ EXCEPTION",
        "Record Count": 0,
        "Latency (ms)": "N/A",
        Details: err.message,
      });
    }
  }

  const totalTime = Date.now() - startTime;

  console.table(results);

  console.log("\n-------------------------------------------------");
  console.log(`⏱️ Total Verification Time: ${totalTime}ms`);
  if (overallSuccess) {
    console.log("🎉 ALL DATABASE TABLES ARE HEALTHY AND FULLY OPERATIONAL!");
  } else {
    console.log("⚠️ SOME TABLES FACED ERRORS. CHECK THE DETAILS TABLE ABOVE.");
  }
  console.log("-------------------------------------------------\n");

  process.exit(overallSuccess ? 0 : 1);
}

checkDatabase();
