const { createSupabaseClient, supabaseAdmin } = require("./supabase-client");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

async function signUpWithEmail({ email, password, metadata = {} }) {
  const client = createSupabaseClient();
  return client.auth.signUp({
    email: normalizeEmail(email),
    password,
    options: {
      data: metadata,
    },
  });
}

async function signInWithEmailPassword({ email, password }) {
  const client = createSupabaseClient();
  return client.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });
}

async function getUserFromAccessToken(accessToken) {
  if (!accessToken) {
    return { data: { user: null }, error: new Error("Access token is required") };
  }

  return supabaseAdmin.auth.getUser(accessToken);
}

async function deleteAuthUser(userId) {
  if (!userId) {
    return { data: null, error: null };
  }

  return supabaseAdmin.auth.admin.deleteUser(userId);
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  signUpWithEmail,
  signInWithEmailPassword,
  getUserFromAccessToken,
  deleteAuthUser,
};
