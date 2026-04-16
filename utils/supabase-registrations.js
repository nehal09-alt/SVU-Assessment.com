const { supabaseAdmin } = require("./supabase-client");

const REGISTRATION_TABLE_CANDIDATES = [
  process.env.SUPABASE_REGISTRATIONS_TABLE,
  "registrations",
  "registration data",
  "registration_data",
].filter(Boolean);

const REGISTRATION_ALLOWED_COLUMNS = new Set([
  "id",
  "email",
  "password",
  "regnumber",
  "registrationdate",
  "lastlogin",
  "photodata",
  "otpcode",
  "otpexpiry",
  "verified",
  "created_at",
  "updated_at",
  "admitnumber",
  "studentname",
  "profilephoto",
  "department",
  "year",
  "semester",
]);

function sanitizeRegistrationData(registrationData) {
  return Object.fromEntries(
    Object.entries(registrationData || {}).filter(([key, value]) => {
      if (value === undefined) {
        return false;
      }
      return REGISTRATION_ALLOWED_COLUMNS.has(key);
    })
  );
}

function getMissingColumnFromError(error) {
  if (!error || String(error.code || "") !== "PGRST204") {
    return "";
  }

  const message = String(error.message || "");
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match ? match[1] : "";
}

function isMissingTableError(error) {
  if (!error) {
    return false;
  }

  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

async function runRegistrationQuery(buildQuery) {
  let lastError = null;

  for (const tableName of REGISTRATION_TABLE_CANDIDATES) {
    const { data, error, count } = await buildQuery(tableName);

    if (!error) {
      return { data, count, tableName, error: null };
    }

    lastError = error;
    if (!isMissingTableError(error)) {
      return { data, count, tableName, error };
    }
  }

  return {
    data: null,
    count: null,
    tableName: REGISTRATION_TABLE_CANDIDATES[0] || "registrations",
    error: lastError,
  };
}

function compactPatch(patch) {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
}

/**
 * Apply a partial update by primary key (avoids sending the whole row and hitting unknown/bad columns).
 */
async function updateRegistrationById(id, patch) {
  if (!id) {
    return null;
  }

  const clean = compactPatch(patch);
  if (Object.keys(clean).length === 0) {
    return null;
  }

  try {
    const { data, error } = await runRegistrationQuery((tableName) =>
      supabaseAdmin.from(tableName).update(clean).eq("id", id).select()
    );

    if (error) {
      console.error("Error updating registration:", error);
      return null;
    }

    return data?.[0] || null;
  } catch (err) {
    console.error("Error updating registration:", err);
    return null;
  }
}

/** Detect OTP column naming used in this database row. */
function registrationUsesSnakeOtpColumns(row) {
  return row && Object.prototype.hasOwnProperty.call(row, "otp_code");
}

function buildOtpPersistPatch(row, otp, expiryIso) {
  if (registrationUsesSnakeOtpColumns(row)) {
    return { otp_code: otp, otp_expiry: expiryIso };
  }
  return { otpcode: otp, otpexpiry: expiryIso };
}

function buildClearOtpPatch(row) {
  if (registrationUsesSnakeOtpColumns(row)) {
    return { otp_code: null, otp_expiry: null };
  }
  return { otpcode: null, otpexpiry: null };
}

function buildPasswordResetPersistPatch(row, hashedPassword) {
  return {
    password: hashedPassword,
    ...buildClearOtpPatch(row),
  };
}

/**
 * Load all registrations from Supabase
 */
async function loadRegistrations() {
  try {
    const { data, error } = await runRegistrationQuery((tableName) =>
      supabaseAdmin.from(tableName).select("*")
    );

    if (error) {
      console.error("Error loading registrations from Supabase:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Error loading registrations:", err);
    return [];
  }
}

async function checkRegistrationsHealth() {
  try {
    const { error, count, tableName } = await runRegistrationQuery((tableName) =>
      supabaseAdmin.from(tableName).select("id", { count: "exact", head: true })
    );

    if (error) {
      return {
        ok: false,
        message: error.message || "Supabase registrations query failed",
        code: error.code || "",
      };
    }

    return {
      ok: true,
      tableName,
      count: typeof count === "number" ? count : null,
    };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? err.message : "Unknown Supabase error",
      code: err && err.code ? String(err.code) : "",
    };
  }
}

/**
 * Find registration by ID
 */
async function findRegistration(registrationIdOrEmail) {
  if (!registrationIdOrEmail) {
    return null;
  }

  const lookup = registrationIdOrEmail.toString().trim();
  if (!lookup) {
    return null;
  }

  try {
    const { data, error } = await runRegistrationQuery((tableName) => {
      let query = supabaseAdmin.from(tableName).select("*");

      if (lookup.includes("@")) {
        query = query.eq("email", lookup.toLowerCase());
      } else {
        query = query.or(`id.eq.${lookup},regnumber.eq.${lookup}`);
      }

      return query.single();
    });

    if (error && error.code !== "PGRST116") {
      console.error("Error finding registration:", error);
    }

    return data || null;
  } catch (err) {
    console.error("Error finding registration:", err);
    return null;
  }
}

/**
 * Save registration to Supabase
 */
async function saveRegistration(registrationData) {
  try {
    let sanitized = sanitizeRegistrationData(registrationData);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await runRegistrationQuery((tableName) => {
      let query = supabaseAdmin.from(tableName);

      if (sanitized.id) {
        query = query.update(sanitized).eq("id", sanitized.id);
      } else {
        query = query.insert([sanitized]);
      }

      return query.select();
      });

      if (!error) {
        return data?.[0] || null;
      }

      const missingColumn = getMissingColumnFromError(error);
      if (missingColumn && Object.prototype.hasOwnProperty.call(sanitized, missingColumn)) {
        console.warn(`Retrying registration save without unsupported column: ${missingColumn}`);
        delete sanitized[missingColumn];
        continue;
      }

      console.error("Error saving registration:", error);
      return null;
    }

    return null;
  } catch (err) {
    console.error("Error saving registration:", err);
    return null;
  }
}

/**
 * Delete registration from Supabase
 */
async function deleteRegistration(registrationId) {
  try {
    const { error } = await runRegistrationQuery((tableName) =>
      supabaseAdmin.from(tableName).delete().eq("id", registrationId)
    );

    if (error) {
      console.error("Error deleting registration:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error deleting registration:", err);
    return false;
  }
}

module.exports = {
  loadRegistrations,
  checkRegistrationsHealth,
  findRegistration,
  saveRegistration,
  deleteRegistration,
  updateRegistrationById,
  buildOtpPersistPatch,
  buildClearOtpPatch,
  buildPasswordResetPersistPatch,
};
