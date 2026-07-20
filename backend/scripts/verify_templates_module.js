require("dotenv").config();
const supabase = require("../utils/supabase");
const logger = require("../utils/logger");

async function runVerification() {
  console.log("=== Testing Database Templates Schema and Insertion ===");
  const testTemplateName = `test_verification_template_${Date.now()}`;
  
  try {
    // 1. Insert template with new metadata columns
    const { data: inserted, error: insertError } = await supabase
      .from("templates")
      .insert([
        {
          name: testTemplateName,
          body: "Hello {{1}}, welcome to {{2}}!",
          type: "interactive",
          category: "MARKETING",
          language: "en",
          status: "draft",
          variables: ["1", "2"],
          buttons: [{ type: "reply", text: "Click Me" }],
          version: 1,
        }
      ])
      .select()
      .single();

    if (insertError) {
      console.error("❌ Insertion failed! Check if you successfully ran the database migration queries inside your Supabase dashboard.");
      throw insertError;
    }

    console.log("✅ Template successfully created with new fields:");
    console.log(`   - ID: ${inserted.id}`);
    console.log(`   - Name: ${inserted.name}`);
    console.log(`   - Category: ${inserted.category}`);
    console.log(`   - Language: ${inserted.language}`);
    console.log(`   - Status: ${inserted.status}`);
    console.log(`   - Version: ${inserted.version}`);
    console.log(`   - Buttons: ${JSON.stringify(inserted.buttons)}`);
    console.log(`   - Variables: ${JSON.stringify(inserted.variables)}`);

    // 2. Fetch and assert the inserted data
    const { data: fetched, error: fetchError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", inserted.id)
      .single();

    if (fetchError) throw fetchError;
    
    if (fetched.category === "MARKETING" && fetched.language === "en" && fetched.status === "draft") {
      console.log("✅ Verification successful! Database structure and integration are perfectly operational.");
    } else {
      throw new Error("Metadata mismatch on fetched template record.");
    }

    // 3. Cleanup test template
    await supabase.from("templates").delete().eq("id", inserted.id);
    console.log("✅ Successfully cleaned up test record.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Verification failed with error:", err.message);
    process.exit(1);
  }
}

runVerification();
