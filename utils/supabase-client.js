require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
};

function createSupabaseClient(accessToken) {
  const options = {
    ...clientOptions,
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  };

  return createClient(supabaseUrl, supabaseAnonKey, options);
}

function createSupabaseAdminClient() {
  return createClient(
    supabaseUrl,
    supabaseSecretKey || supabaseAnonKey,
    clientOptions
  );
}

const supabase = createSupabaseClient();
const supabaseAdmin = createSupabaseAdminClient();

module.exports = {
  supabase,
  supabaseAdmin,
  supabaseUrl,
  supabaseAnonKey,
  createSupabaseClient,
  createSupabaseAdminClient,
};
