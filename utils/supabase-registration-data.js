const { supabaseAdmin } = require("./supabase-client");

const REGISTRATION_DATA_TABLE = process.env.SUPABASE_REGISTRATION_TABLE || "registration_data";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeRegistrationNumber(registrationNumber) {
  return String(registrationNumber || "").trim();
}

function createTableMissingError(error) {
  const nextError = new Error(
    `Supabase table "${REGISTRATION_DATA_TABLE}" is missing. Run the registration_data SQL migration first.`
  );
  nextError.code = error?.code || "TABLE_MISSING";
  nextError.cause = error || null;
  return nextError;
}

function normalizeTableError(error) {
  if (!error) {
    return null;
  }

  if (error.code === "PGRST205" || error.code === "42P01") {
    return createTableMissingError(error);
  }

  return error;
}

async function findRegistrationDataByUserId(userId) {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from(REGISTRATION_DATA_TABLE)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw normalizeTableError(error);
  }

  return data || null;
}

async function findRegistrationDataByRegistrationNumber(registrationNumber) {
  const normalized = normalizeRegistrationNumber(registrationNumber);
  if (!normalized) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from(REGISTRATION_DATA_TABLE)
    .select("*")
    .eq("registration_number", normalized)
    .maybeSingle();

  if (error) {
    throw normalizeTableError(error);
  }

  return data || null;
}

async function findRegistrationDataByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from(REGISTRATION_DATA_TABLE)
    .select("*")
    .eq("email", normalized)
    .maybeSingle();

  if (error) {
    throw normalizeTableError(error);
  }

  return data || null;
}

async function insertRegistrationData(row) {
  const payload = {
    user_id: row.user_id,
    email: normalizeEmail(row.email),
    registration_number: normalizeRegistrationNumber(row.registration_number),
  };

  const { data, error } = await supabaseAdmin
    .from(REGISTRATION_DATA_TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw normalizeTableError(error);
  }

  return data;
}

async function updateRegistrationDataByUserId(userId, patch) {
  if (!userId || !patch || Object.keys(patch).length === 0) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from(REGISTRATION_DATA_TABLE)
    .update(patch)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    throw normalizeTableError(error);
  }

  return data;
}

module.exports = {
  REGISTRATION_DATA_TABLE,
  normalizeEmail,
  normalizeRegistrationNumber,
  findRegistrationDataByUserId,
  findRegistrationDataByRegistrationNumber,
  findRegistrationDataByEmail,
  insertRegistrationData,
  updateRegistrationDataByUserId,
};
