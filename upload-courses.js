const { importCoursesToSupabase } = require("./utils/supabase-courses");

async function main() {
  console.log("Starting course upload to Supabase...");
  const result = await importCoursesToSupabase();

  if (result.success) {
    console.log(`✅ Successfully uploaded ${result.count} courses to Supabase.`);
  } else {
    console.error(`❌ Failed to upload courses: ${result.message}`);
  }
}

main().catch(console.error);