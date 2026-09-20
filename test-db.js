require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Database connection failed: Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  process.exit(1);
}

(async () => {
  try {
    const client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await client.from("students").select("regnum").limit(1);

    if (error) {
      throw error;
    }

    console.log("✅ Supabase database connected successfully.");
    console.log("Sample record count:", Array.isArray(data) ? data.length : 0);
    process.exit(0);
  } catch (error) {
    console.error("❌ Database connection failed:", error && error.message ? error.message : error);
    process.exit(1);
  }
})();
