const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { isEmailConfigured, getEmailHealth, sendOtpEmail } = require("./utils/mailer");
const { getStudentProfile, findStudentByRegNumber } = require("./utils/supabase-student-data");
const {
  findRegistration,
  saveRegistration,
  updateRegistrationById,
  buildOtpPersistPatch,
  buildPasswordResetPersistPatch,
  checkRegistrationsHealth,
} = require("./utils/supabase-registrations");
const { getUniqueCourseNames, getCoursesFor, getSemestersForCourse, getSupabaseCoursesForStudent, importCoursesToSupabase } = require("./utils/supabase-courses");
const { findFacultyByEmail, saveFaculty } = require("./utils/supabase-faculty");
const {
  ASSIGNMENT_BUCKET,
  SUBMISSION_BUCKET,
  createAssignment,
  ensureProfile,
  gradeSubmission,
  listFacultyDashboard,
  listStudentDashboard,
  submitAssignment,
} = require("./utils/supabase-assignments");
const {
  createAssessment,
  listFacultyAssessmentDashboard,
  listStudentAssessmentDashboard,
  upsertAssessmentMark,
} = require("./utils/supabase-assessments");
const {
  normalizeEmail,
  isValidEmail,
  signUpWithEmail,
  signInWithEmailPassword,
  getUserFromAccessToken,
  deleteAuthUser,
} = require("./utils/supabase-auth");
const {
  REGISTRATION_DATA_TABLE,
  normalizeRegistrationNumber,
  findRegistrationDataByUserId,
  findRegistrationDataByRegistrationNumber,
  findRegistrationDataByEmail,
  insertRegistrationData,
  updateRegistrationDataByUserId,
} = require("./utils/supabase-registration-data");


function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnvFile();

function isMissingProfilesTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("public.profiles") ||
    message.includes("relation \"profiles\" does not exist") ||
    message.includes("could not find the table") ||
    message.includes("table 'profiles'")
  );
}

function createSyntheticProfile({ role, name, email = "", regNumber = "" }) {
  const normalizedRole = role === "faculty" ? "faculty" : "student";
  return {
    id: crypto.createHash("sha256").update(`${normalizedRole}:${String(email).toLowerCase()}:${String(regNumber).toUpperCase()}`).digest("hex").slice(0, 32),
    name: String(name || (normalizedRole === "faculty" ? "Faculty Member" : "Student")).trim(),
    role: normalizedRole,
  };
}

async function safeEnsureProfile(profileArgs) {
  try {
    return await ensureProfile(profileArgs);
  } catch (err) {
    if (isMissingProfilesTableError(err)) {
      console.warn("Fallback to synthetic profile because the Supabase profiles table is unavailable.", err.message);
      return createSyntheticProfile(profileArgs);
    }
    throw err;
  }
}

const app = express();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "5mb";
const PORT = Number(process.env.PORT) || 3010;
const OTP_TTL_MS = Number(process.env.OTP_TTL_MS) || 5 * 60 * 1000;
const OTP_CLOCK_SKEW_MS = Number(process.env.OTP_CLOCK_SKEW_MS) || 30 * 1000;

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const configuredFrontendUrl = String(process.env.FRONTEND_URL || "").trim();
  const allowedOrigins = new Set([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
    "http://127.0.0.1:3010",
    "http://localhost:3010",
  ]);

  if (configuredFrontendUrl) {
    try {
      allowedOrigins.add(new URL(configuredFrontendUrl).origin);
    } catch (_) {
      allowedOrigins.add(configuredFrontendUrl.replace(/\/$/, ""));
    }
  }

  if (origin && (allowedOrigins.has(origin) || origin === new URL(process.env.SUPABASE_URL || "https://example.com").origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else if (!origin && configuredFrontendUrl) {
    res.header("Access-Control-Allow-Origin", configuredFrontendUrl.replace(/\/$/, ""));
  } else if (!origin) {
    res.header("Access-Control-Allow-Origin", "http://localhost:3010");
  }

  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

// Serve the client HTML/JS/CSS from the htmlpager folder.
// This makes URLs like /SVUassessment.html work without needing /htmlpager/ prefix.
const staticOpts = {
  setHeaders(res, filePath) {
    if (/\.(js|css|webp|png|jpg|jpeg|svg|woff2?|ico)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
  },
};

app.use(express.static(path.join(__dirname, "htmlpager"), staticOpts));
app.use("/htmlpager", express.static(path.join(__dirname, "htmlpager"), staticOpts));

app.get("/", (req, res) => {
  return res.redirect(302, "/SVUlanding.html");
});

let studentData = [];

function loadStudentData() {
  // Try loading from JSON first (preferred)
  const jsonPath = path.join(__dirname, 'data', 'students.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const jsonData = fs.readFileSync(jsonPath, 'utf8');
      studentData = JSON.parse(jsonData) || [];
      return;
    } catch (err) {
      console.error('Error loading JSON:', err.message);
    }
  }

  // Fallback to CSV parsing
  const csvPath = path.join(__dirname, 'CSE_2024', 'CSE 2024.csv');
  if (fs.existsSync(csvPath)) {
    try {
      const data = fs.readFileSync(csvPath, 'utf8');
      const lines = data.split('\n');
      const headerIndex = lines.findIndex(line => line.startsWith('S.No.,Name'));
      if (headerIndex !== -1) {
        const dataLines = lines.slice(headerIndex + 1);
        studentData = dataLines.map(line => {
          const parts = line.split(',').map(s => s.trim());
          if (parts.length >= 8 && parts[0] && parts[3]) {
            return {
              sno: parts[0],
              name: parts[1],
              dept: parts[2],
              regNum: parts[3],
              rollNum: parts[4],
              abcId: parts[5] || '',
              dob: parts[6] || '',
              gender: parts[7] || ''
            };
          }
          return null;
        }).filter(item => item && item.regNum);
      }
    } catch (err) {
      console.error('Error loading CSV:', err.message);
    }
  }

  if (studentData.length === 0) {
    console.warn('No student data loaded from JSON or CSV');
  }
}

loadStudentData();

function parseAdmissionYearFromRegNumber(regNumber) {
  if (!regNumber || typeof regNumber !== 'string') {
    return null;
  }

  const match = regNumber.match(/20\d{2}/g);
  if (!match || match.length === 0) {
    return null;
  }

  const candidate = Number(match[match.length - 1]);
  return Number.isFinite(candidate) ? candidate : null;
}

function calculateSemesterFromRegNumber(regNumber) {
  const admissionYear = parseAdmissionYearFromRegNumber(regNumber);
  if (!admissionYear) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const yearDiff = Math.max(0, currentYear - admissionYear);
  const semester = Math.max(1, yearDiff * 2);
  return semester;
}

function formatSemesterLabel(semesterNumber) {
  const sem = Number(semesterNumber);
  if (!Number.isFinite(sem) || sem < 1) return "";
  const suffix = sem % 10 === 1 && sem % 100 !== 11 ? "st"
    : sem % 10 === 2 && sem % 100 !== 12 ? "nd"
    : sem % 10 === 3 && sem % 100 !== 13 ? "rd"
    : "th";
  return `${sem}${suffix} Semester`;
}

function normalizeFacultyEmail(email) {
  return (String(email || "").trim().toLowerCase());
}

function normalizeSemesterValue(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : String(value || "").trim();
}

function deriveStudyYearFromSemester(semester) {
  const sem = Number(normalizeSemesterValue(semester));
  if (!Number.isFinite(sem) || sem < 1) return null;
  return Math.ceil(sem / 2);
}

function formatStudyYearLabel(yearValue) {
  const year = Number(String(yearValue || "").match(/\d+/)?.[0] || yearValue);
  if (!Number.isFinite(year) || year < 1) return "";
  const suffix = year % 10 === 1 && year % 100 !== 11 ? "st"
    : year % 10 === 2 && year % 100 !== 12 ? "nd"
    : year % 10 === 3 && year % 100 !== 13 ? "rd"
    : "th";
  return `${year}${suffix} Year`;
}

async function fetchHtml(url) {
  if (typeof fetch === "function") {
    const response = await fetch(url, { headers: { "User-Agent": "svu-sync-bot/1.0" } });
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }

  return new Promise((resolve, reject) => {
    const https = require("https");
    https
      .get(url, { headers: { "User-Agent": "svu-sync-bot/1.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString("utf8");
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`Fetch failed: ${res.statusCode}`));
          }
        });
      })
      .on("error", reject);
  });
}

function parseNoticeBoardHtml(html) {
  const text = String(html || "").replace(/\r?\n/g, " ");
  const pattern = /##\s*(\d{1,2})(?:[^\[]*?)\[([^\]]+?)\]\((https?:\/\/[^\)]+?)\)\s*\[Read Details\s*\]\((https?:\/\/[^\)]+?)\)([^#]*)/gi;
  const notices = [];

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const day = match[1];
    const title = match[2].trim();
    const url = match[3].trim();
    const detailsUrl = match[4].trim();
    const month = (match[5] || "").trim();
    const publishedAt = month ? `${day} ${month}` : `${day}`;

    notices.push({
      title,
      url,
      detailsUrl,
      publishedAt,
    });
  }

  if (notices.length > 0) {
    return notices.slice(0, 40);
  }

  const anchorPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
  const anchors = [];
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1].trim();
    const title = match[2].trim();
    if (title && href && !/^Read Details$/i.test(title)) {
      anchors.push({ title, href });
    }
  }

  return anchors.slice(0, 20).map((item) => ({
    title: item.title,
    url: item.href,
    detailsUrl: item.href,
    publishedAt: "",
  }));
}

/**
 * Validate password requirements:
 * - Must contain lowercase letter
 * - Must contain number
 * - Must contain special character (!@#$%^&*)
 * - Must not contain uppercase letter
 */
function validatePassword(password) {
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*]/.test(password);
  const hasNoUppercase = !/[A-Z]/.test(password);

  return {
    isValid: hasLowercase && hasNumber && hasSpecial && hasNoUppercase,
    hasLowercase,
    hasNumber,
    hasSpecial,
    hasNoUppercase,
  };
}

function getSubmittedEmail(body) {
  return (body.email || body.forgotEmail || body.userEmail || "").toString().trim().toLowerCase();
}

function readStoredOtpCode(row) {
  if (!row) return "";
  const raw = row.otpcode ?? row.otp_code ?? row.otpCode;
  if (raw == null) return "";
  return String(raw).trim();
}

function readStoredOtpExpiry(row) {
  if (!row) return null;
  return row.otpexpiry ?? row.otp_expiry ?? row.otpExpiry ?? null;
}

function parseOtpExpiryMs(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value);
    return n > 1e12 ? n : n * 1000;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Supabase timestamp columns may return timezone-less strings. Treat them as UTC
    // so freshly issued OTPs are not considered expired on servers in other timezones.
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
      return new Date(trimmed.replace(" ", "T") + "Z").getTime();
    }
  }
  const t = new Date(value).getTime();
  return t;
}

function createOtpPayload() {
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAtMs = Date.now() + OTP_TTL_MS;
  return {
    otp,
    expiresAtMs,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
  };
}

function maskEmail(email) {
  const normalized = (email || "").toString().trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 1) {
    return normalized || "<empty-email>";
  }

  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const visibleLocal = local.slice(0, 2);
  return `${visibleLocal}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function createTraceId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function logOtpFlow(traceId, stage, details = {}) {
  const safeDetails = { ...details };
  if (safeDetails.email) {
    safeDetails.email = maskEmail(safeDetails.email);
  }

  console.log(`[${traceId}] ${stage}`, safeDetails);
}

async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) reject(err);
      else resolve(hash);
    });
  });
}

async function persistUpdatedPassword(registration, hashedPassword) {
  const passwordPatch = buildPasswordResetPersistPatch(registration, hashedPassword);
  let updatedRegistration = await updateRegistrationById(registration.id, passwordPatch);

  if (!updatedRegistration) {
    return null;
  }

  const reloadedRegistration = await findRegistration((registration.email || "").toLowerCase());
  if (!reloadedRegistration) {
    return updatedRegistration;
  }

  if (reloadedRegistration.password === hashedPassword) {
    return reloadedRegistration;
  }

  const fallbackRegistration = await saveRegistration({
    ...reloadedRegistration,
    ...passwordPatch,
  });

  return fallbackRegistration || reloadedRegistration;
}

function getSubmittedToken(body, req) {
  return (
    (body && body.token) ||
    (req && req.headers && req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, "") : "") ||
    (req && req.query && req.query.token) ||
    ""
  )
    .toString()
    .trim();
}

function isBcryptHash(value) {
  return typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
}

function compareStoredPassword(storedPassword, candidatePassword) {
  if (typeof storedPassword !== "string" || !storedPassword.trim()) {
    console.warn("[auth:student] stored password missing or invalid", {
      hasStoredPassword: typeof storedPassword === "string",
      storedPasswordLength: typeof storedPassword === "string" ? storedPassword.length : 0,
      hasCandidatePassword: typeof candidatePassword === "string",
    });
    return Promise.resolve(false);
  }

  if (!isBcryptHash(storedPassword)) {
    console.warn("[auth:student] stored password is not a valid bcrypt hash", {
      hasStoredPassword: true,
      storedPasswordLength: storedPassword.length,
      hasCandidatePassword: typeof candidatePassword === "string",
    });
    return Promise.resolve(false);
  }

  return new Promise((resolve, reject) => {
    bcrypt.compare(candidatePassword, storedPassword, (err, isMatch) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(Boolean(isMatch));
    });
  });
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

const PROFILE_TOKEN_SECRET =
  process.env.PROFILE_TOKEN_SECRET ||
  process.env.APP_SECRET ||
  "svu-dashboard-local-secret";
const PROFILE_TOKEN_TTL_MS = Number(process.env.PROFILE_TOKEN_TTL_MS) || 24 * 60 * 60 * 1000;

function safeProfileSummary(entry, studentProfile) {
  const rawSemester = entry.semester;
  const semesterLabel = rawSemester == null || rawSemester === ""
    ? ""
    : (Number.isFinite(Number(rawSemester)) ? formatSemesterLabel(Number(rawSemester)) : String(rawSemester));
  const rawYear = entry.year;
  const yearLabel = rawYear == null || rawYear === ""
    ? ""
    : (Number.isFinite(Number(rawYear)) ? formatStudyYearLabel(Number(rawYear)) : String(rawYear));

  return {
    studentName: studentProfile?.studentName || entry.studentName || entry.studentname || "",
    regNumber: studentProfile?.regNumber || entry.registration_number || entry.regnumber || entry.regNumber || "",
    admitNumber: studentProfile?.admitNumber || entry.admitnumber || entry.admitNumber || "",
    admitCardNumber: studentProfile?.admitCardNumber || studentProfile?.admitNumber || entry.admitnumber || entry.admitNumber || "",
    email: entry.email || "",
    course: studentProfile?.course || entry.department || entry.course || "",
    year: yearLabel,
    semester: semesterLabel,
    passwordStatus: "hidden",
  };
}

function getAssignmentSummary(entry) {
  const assignments = Array.isArray(entry.assignments)
    ? entry.assignments
    : Array.isArray(entry.assignmentDetails)
      ? entry.assignmentDetails
      : Array.isArray(entry.assignmentList)
        ? entry.assignmentList
        : [];

  if (assignments.length === 0) {
    return {
      total: 0,
      given: 0,
      notGiven: 0,
    };
  }

  let given = 0;
  let notGiven = 0;

  for (const item of assignments) {
    const status = String(item && (item.status || item.state || item.submissionStatus || "")).toLowerCase();
    if (status === "not given" || status === "pending" || status === "missed") {
      notGiven += 1;
    } else {
      given += 1;
    }
  }

  return {
    total: assignments.length,
    given,
    notGiven,
  };
}

function createProfileToken(entry) {
  const payload = {
    regNumber: entry.regnumber || entry.regNumber || "",
    email: (entry.email || "").toLowerCase(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + PROFILE_TOKEN_TTL_MS,
  };
  const payloadText = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", PROFILE_TOKEN_SECRET)
    .update(`${payloadText}|${entry.password || ""}`)
    .digest("hex");

  return `${Buffer.from(payloadText).toString("base64url")}.${signature}`;
}

function parseProfileToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return null;
  }

  try {
    const payloadText = Buffer.from(parts[0], "base64url").toString("utf8");
    const payload = JSON.parse(payloadText);
    if (!payload || typeof payload !== "object") {
      return null;
    }

    return {
      payload,
      signature: parts[1],
      payloadText,
    };
  } catch (err) {
    return null;
  }
}

function resolveProfileFromToken(token, list) {
  const parsed = parseProfileToken(token);
  if (!parsed) {
    return null;
  }

  const { payload, signature, payloadText } = parsed;
  if (!payload.regNumber || !payload.email || !payload.expiresAt || Date.now() > payload.expiresAt) {
    return null;
  }

  const record = list.find((entry) => {
    const entryReg = entry.regNumber || entry.regnumber;
    const entryEmail = (entry.email || "").toLowerCase();
    return entryReg === payload.regNumber && entryEmail === payload.email;
  });
  if (!record) {
    return null;
  }

  const expectedSignature = crypto.createHmac("sha256", PROFILE_TOKEN_SECRET).update(`${payloadText}|${record.password || ""}`).digest("hex");

  if (!timingSafeEqualString(signature, expectedSignature)) {
    return null;
  }

  return record;
}

function buildProfileResponse(entry, studentProfile) {
  return {
    profile: safeProfileSummary(entry, studentProfile),
    assignmentSummary: getAssignmentSummary(entry),
    subjectDetails: Array.isArray(entry.subjectDetails) ? entry.subjectDetails : [],
    profilePhoto: typeof entry.profilephoto === "string"
      ? entry.profilephoto
      : (typeof entry.profilePhoto === "string"
        ? entry.profilePhoto
        : (typeof entry.profile_photo === "string" ? entry.profile_photo : "")),
    profileToken: createProfileToken(entry),
  };
}

function getAccessTokenFromRequest(req) {
  const authHeader = (req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }

  const bodyToken = req.body && typeof req.body.token === "string" ? req.body.token.trim() : "";
  if (bodyToken) {
    return bodyToken;
  }

  const queryToken = req.query && typeof req.query.token === "string" ? req.query.token.trim() : "";
  return queryToken;
}

async function getAuthenticatedRegistrationContext(req) {
  const accessToken = getAccessTokenFromRequest(req);
  if (!accessToken) {
    return { accessToken: "", user: null, registration: null, error: "Access token is required." };
  }

  const { data, error } = await getUserFromAccessToken(accessToken);
  if (error || !data?.user?.id) {
    return {
      accessToken,
      user: null,
      registration: null,
      error: error?.message || "Invalid or expired access token.",
    };
  }

  const registration = await findRegistrationDataByUserId(data.user.id);
  if (!registration) {
    return {
      accessToken,
      user: data.user,
      registration: null,
      error: `No row found in ${REGISTRATION_DATA_TABLE} for this authenticated user.`,
    };
  }

  return {
    accessToken,
    user: data.user,
    registration,
    error: "",
  };
}

function isSafeImageDataUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(trimmed)) {
    return false;
  }

  return Buffer.byteLength(trimmed, "utf8") <= 2 * 1024 * 1024;
}

app.get(["/student-info", "/student_info/:regNum"], async (req, res) => {
  const regNumber = String(req.params?.regNum || req.query.regNumber || "").trim();

  console.log("[student-info] Request received", {
    regNumber,
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseSecret: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    localStudentDataLoaded: studentData.length,
    table: "students",
    column: "regnum",
  });

  if (!regNumber) {
    return res.status(400).json({ message: "regNumber is required" });
  }

  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error("[student-info] Missing required Supabase environment variables.", {
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseSecret: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
    return res.status(500).json({
      message: "Student lookup is misconfigured. Missing SUPABASE_URL and SUPABASE_SECRET_KEY.",
    });
  }

  try {
    let match = studentData.find((s) => (s.regNum || s.regnum || "").toString().trim() === regNumber);

    if (!match) {
      match = await findStudentByRegNumber(regNumber);
    }

    if (!match) {
      console.warn("[student-info] Student not found in local dataset or Supabase:", { regNumber, table: "students", column: "regnum" });
      return res.status(404).json({ message: "Student not found" });
    }

    const semesterNumber = match.semester || calculateSemesterFromRegNumber(match.regNum || match.regnum || "") || null;
    return res.status(200).json({
      regNumber: match.regNum || match.regnum || "",
      admitNumber: String(match.rollNum || match.rollnum || match.sno || "").padStart(3, "0"),
      studentName: match.name || match.studentName || "",
      course: match.course || match.dept || "",
      semester: semesterNumber ? formatSemesterLabel(semesterNumber) : "",
    });
  } catch (err) {
    console.error("[student-info] Supabase query error while retrieving student-info:", err);
    return res.status(500).json({
      message: "Failed to retrieve student info from Supabase.",
      detail: err && err.message ? err.message : "Unknown server error",
    });
  }
});

app.get("/external-notices", async (req, res) => {
  const sourceUrl = "https://www.swamivivekanandauniversity.ac.in/notice-board";

  try {
    const html = await fetchHtml(sourceUrl);
    const notices = parseNoticeBoardHtml(html);
    return res.status(200).json({
      source: sourceUrl,
      count: notices.length,
      notices,
    });
  } catch (err) {
    console.error("Error fetching external notices:", err);
    return res.status(500).json({ message: "Could not fetch the official notice board." });
  }
});

app.get("/courses", async (req, res) => {
  try {
    const courseQuery = (req.query.course || "").toString().trim();
    const semesterQuery = (req.query.semester || "").toString().trim();
    const unique = String(req.query.unique || "").toLowerCase() === "true";
    const semesters = String(req.query.semesters || "").toLowerCase() === "true";

    if (unique) {
      return res.status(200).json({ courses: getUniqueCourseNames() });
    }

    if (semesters) {
      return res.status(200).json({ semesters: getSemestersForCourse(courseQuery) });
    }

    const subjects = getCoursesFor(courseQuery, semesterQuery);
    return res.status(200).json({ subjects });
  } catch (err) {
    console.error("Error loading course data:", err);
    return res.status(500).json({ message: "Could not load course list." });
  }
});

app.post("/admin/import-courses", async (req, res) => {
  const secret = (req.headers["x-admin-secret"] || req.body?.adminSecret || "").toString();
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ message: "Admin authorization required." });
  }

  const result = await importCoursesToSupabase();
  if (!result.success) {
    return res.status(500).json({ message: result.message || "Could not import courses." });
  }

  return res.status(200).json({ message: "Courses imported successfully.", imported: result.count });
});

app.post("/faculty/signin", async (req, res) => {
  const email = normalizeFacultyEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const faculty = await findFacultyByEmail(email);
    if (!faculty || faculty.approved === false) {
      return res.status(401).json({ message: "You are not registered as faculty." });
    }

    const isMatch = await compareStoredPassword(faculty.password, password);
    if (!isMatch) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    return res.status(200).json({
      message: "Faculty sign in successful.",
      faculty: {
        name: faculty.name || "Faculty Member",
        email: faculty.email,
        role: faculty.role || "faculty",
        subjects: Array.isArray(faculty.subjects) ? faculty.subjects : [],
      },
    });
  } catch (err) {
    console.error("Error during faculty signin:", err);
    return res.status(500).json({ message: "Could not sign in faculty." });
  }
});

app.post("/admin/faculty/create", async (req, res) => {
  const secret = (req.headers["x-admin-secret"] || req.body?.adminSecret || "").toString();
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ message: "Admin authorization required." });
  }

  const email = normalizeFacultyEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim();
  const role = String(req.body?.role || "faculty").trim();
  const subjects = req.body?.subjects || [];

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required to create a faculty account." });
  }

  try {
    const hashedPassword = await hashPassword(password);
    const saved = await saveFaculty({
      email,
      name,
      role,
      subjects,
      password: hashedPassword,
      approved: true,
    });

    if (!saved) {
      return res.status(500).json({ message: "Could not save faculty account." });
    }

    return res.status(201).json({ message: "Faculty account created successfully.", faculty: {
      email: saved.email,
      name: saved.name,
      role: saved.role,
      subjects: saved.subjects,
    }});
  } catch (err) {
    console.error("Error creating faculty account:", err);
    return res.status(500).json({ message: "Could not create faculty account." });
  }
});

app.post("/admin/seed-faculty", async (req, res) => {
  const secret = (req.headers["x-admin-secret"] || req.body?.adminSecret || "").toString();
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ message: "Admin authorization required." });
  }

  try {
    const sampleFaculty = [
      {
        name: "Dr. Rina Bose",
        email: "rina.bose@svuniversity.ac.in",
        role: "Professor",
        subjects: ["Database Management System", "Artificial Intelligence"],
        password: await hashPassword("svu@2026"),
        approved: true,
      },
      {
        name: "Mr. Arnab Roy",
        email: "arnab.roy@svuniversity.ac.in",
        role: "Assistant Professor",
        subjects: ["Digital and Analog Communications", "Microprocessor & Microcontroller"],
        password: await hashPassword("svu@2026"),
        approved: true,
      },
    ];

    const saved = [];
    for (const faculty of sampleFaculty) {
      const row = await saveFaculty(faculty);
      if (row) saved.push(row);
    }

    return res.status(200).json({ message: "Sample faculty accounts seeded.", seeded: saved.length });
  } catch (err) {
    console.error("Error seeding faculty sample data:", err);
    return res.status(500).json({ message: "Faculty seeding failed." });
  }
});

app.get("/lms/student-subjects", async (req, res) => {
  const regNumber = (req.query.regNumber || "").toString().trim();
  if (!regNumber) {
    return res.status(400).json({ message: "regNumber is required" });
  }

  try {
    const studentProfile = await getStudentProfile(regNumber);
    if (!studentProfile) {
      return res.status(404).json({ message: "Student profile not found." });
    }

    const semester = normalizeSemesterValue(studentProfile.semester);
    const year = deriveStudyYearFromSemester(semester);
    const result = await getSupabaseCoursesForStudent(studentProfile.course, semester, year);

    if (!result.success) {
      return res.status(500).json({ message: result.message || "Could not load student subjects." });
    }

    return res.status(200).json({
      student: {
        regNumber: studentProfile.regNumber,
        name: studentProfile.studentName,
        department: studentProfile.course,
        semester,
        year,
      },
      subjects: result.subjects.map((row) => ({
        id: `${row.course}-${row.year}-${row.semester}-${row.subject}`,
        name: row.subject,
        department: row.course,
        semester: row.semester,
        year: row.year,
      })),
    });
  } catch (err) {
    console.error("Error loading LMS student subjects:", err);
    return res.status(500).json({ message: "Could not load student subjects." });
  }
});

app.get("/lms/assignment/config", (req, res) => {
  return res.status(200).json({
    assignmentBucket: ASSIGNMENT_BUCKET,
    submissionBucket: SUBMISSION_BUCKET,
    maxUploadMb: 10,
  });
});

app.post("/lms/assignment/student/dashboard", async (req, res) => {
  const body = req.body || {};
  const regNumber = String(body.regNumber || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const subjectId = String(body.subjectId || "").trim();
  const subjectName = String(body.subjectName || "").trim();

  if (!regNumber || !email) {
    return res.status(400).json({ message: "regNumber and email are required." });
  }

  try {
    const studentProfile = await getStudentProfile(regNumber);
    if (!studentProfile) {
      return res.status(404).json({ message: "Student profile not found." });
    }

    const lmsProfile = await safeEnsureProfile({
      role: "student",
      name: studentProfile.studentName,
      email,
      regNumber,
    });

    const semester = normalizeSemesterValue(studentProfile.semester || body.semester);
    const courseSubjects = getCoursesFor(studentProfile.course || body.course, semester);
    const allowedSubjectNames = courseSubjects.map((item) => item.subject).filter(Boolean);
    const dashboard = await listStudentDashboard({
      studentProfileId: lmsProfile.id,
      allowedSubjectNames,
      subjectId,
      subjectName,
      department: studentProfile.course || body.course || "",
      semester: normalizeSemesterValue(studentProfile.semester || body.semester),
    });

    return res.status(200).json({
      profile: {
        ...studentProfile,
        id: lmsProfile.id,
        email,
      },
      availableSubjects: allowedSubjectNames,
      ...dashboard,
    });
  } catch (err) {
    console.error("Error loading student assignment dashboard:", err);
    return res.status(500).json({ message: err.message || "Could not load assignment dashboard." });
  }
});

app.post("/lms/assignment/student/submit", async (req, res) => {
  const body = req.body || {};
  const regNumber = String(body.regNumber || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const assignmentId = String(body.assignmentId || "").trim();
  const fileName = String(body.fileName || "").trim();
  const fileType = String(body.fileType || "").trim();
  const fileData = String(body.fileData || "").trim();
  const notes = String(body.notes || "").trim();

  if (!regNumber || !email || !assignmentId || !fileName || !fileData) {
    return res.status(400).json({ message: "regNumber, email, assignmentId, fileName, and fileData are required." });
  }

  try {
    const studentProfile = await getStudentProfile(regNumber);
    if (!studentProfile) {
      return res.status(404).json({ message: "Student profile not found." });
    }

    const lmsProfile = await safeEnsureProfile({
      role: "student",
      name: studentProfile.studentName,
      email,
      regNumber,
    });

    const submission = await submitAssignment({
      studentProfile: lmsProfile,
      assignmentId,
      fileName,
      fileType,
      fileBase64: fileData,
      notes,
    });

    return res.status(201).json({
      message: "Assignment submitted successfully.",
      submission,
    });
  } catch (err) {
    console.error("Error submitting assignment:", err);
    return res.status(500).json({ message: err.message || "Could not submit assignment." });
  }
});

app.post("/lms/assignment/faculty/dashboard", async (req, res) => {
  const body = req.body || {};
  const email = normalizeFacultyEmail(body.email);
  const subjectId = String(body.subjectId || "").trim();

  if (!email) {
    return res.status(400).json({ message: "Faculty email is required." });
  }

  try {
    const faculty = await findFacultyByEmail(email);
    if (!faculty || faculty.approved === false) {
      return res.status(404).json({ message: "Faculty account not found." });
    }

    const allowedSubjects = Array.isArray(body.allowedSubjects)
      ? body.allowedSubjects
      : (Array.isArray(faculty.subjects) ? faculty.subjects : []);

    const facultyProfile = await safeEnsureProfile({
      role: "faculty",
      name: faculty.name,
      email,
    });

    const dashboard = await listFacultyDashboard({
      facultyProfileId: facultyProfile.id,
      allowedSubjects,
      subjectId,
    });

    return res.status(200).json({
      faculty: {
        id: facultyProfile.id,
        name: facultyProfile.name,
        email,
        role: faculty.role || "faculty",
        subjects: allowedSubjects,
      },
      ...dashboard,
    });
  } catch (err) {
    console.error("Error loading faculty assignment dashboard:", err);
    return res.status(500).json({ message: err.message || "Could not load faculty dashboard." });
  }
});

app.post("/lms/assignment/faculty/create", async (req, res) => {
  const body = req.body || {};
  const email = normalizeFacultyEmail(body.email);
  const subjectName = String(body.subjectName || "").trim();
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const dueDate = String(body.dueDate || "").trim();
  const department = String(body.department || "").trim();
  const semester = String(body.semester || "").trim();
  const fileName = String(body.fileName || "").trim();
  const fileType = String(body.fileType || "").trim();
  const fileData = String(body.fileData || "").trim();

  if (!email || !subjectName || !title || !dueDate || !department || !semester) {
    return res.status(400).json({ message: "email, subjectName, title, dueDate, department, and semester are required." });
  }

  try {
    const faculty = await findFacultyByEmail(email);
    if (!faculty || faculty.approved === false) {
      return res.status(404).json({ message: "Faculty account not found." });
    }

    const allowedSubjects = Array.isArray(body.allowedSubjects) ? body.allowedSubjects : (Array.isArray(faculty.subjects) ? faculty.subjects : []);
    if (allowedSubjects.length > 0 && !allowedSubjects.includes(subjectName)) {
      return res.status(403).json({ message: "You can only create assignments for your selected subjects." });
    }

    if (allowedSubjects.length === 0 && Array.isArray(faculty.subjects) && faculty.subjects.length > 0 && !faculty.subjects.includes(subjectName)) {
      return res.status(403).json({ message: "You can only create assignments for your own subjects." });
    }

    const facultyProfile = await safeEnsureProfile({
      role: "faculty",
      name: faculty.name,
      email,
    });

    const assignment = await createAssignment({
      facultyProfile,
      subjectName,
      department,
      semester,
      title,
      description,
      deadline: dueDate,
      fileName: fileName || null,
      fileType: fileType || null,
      fileData: fileData || null,
    });

    return res.status(201).json({
      message: "Assignment created successfully.",
      assignment,
    });
  } catch (err) {
    console.error("Error creating faculty assignment:", err);
    return res.status(500).json({ message: err.message || "Could not create assignment." });
  }
});

app.post("/lms/assignment/faculty/grade", async (req, res) => {
  const body = req.body || {};
  const email = normalizeFacultyEmail(body.email);
  const submissionId = String(body.submissionId || "").trim();
  const marks = body.marks;
  const remarks = String(body.remarks || "").trim();

  if (!email || !submissionId) {
    return res.status(400).json({ message: "email and submissionId are required." });
  }

  try {
    const faculty = await findFacultyByEmail(email);
    if (!faculty || faculty.approved === false) {
      return res.status(404).json({ message: "Faculty account not found." });
    }

    const facultyProfile = await safeEnsureProfile({
      role: "faculty",
      name: faculty.name,
      email,
    });

    const graded = await gradeSubmission({
      submissionId,
      facultyProfileId: facultyProfile.id,
      marks,
      remarks,
    });

    return res.status(200).json({
      message: "Submission graded successfully.",
      submission: graded,
    });
  } catch (err) {
    console.error("Error grading assignment submission:", err);
    return res.status(500).json({ message: err.message || "Could not save grading." });
  }
});

app.get("/lms/assessment/config", (req, res) => {
  return res.status(200).json({
    module: "assessment",
    maxMarksDefault: 100,
  });
});

app.post("/lms/assessment/student/dashboard", async (req, res) => {
  const body = req.body || {};
  const regNumber = String(body.regNumber || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const department = String(body.department || "").trim();
  const semester = String(body.semester || "").trim();
  const year = String(body.year || "").trim();
  const subjectId = String(body.subjectId || "").trim();

  if (!regNumber) {
    return res.status(400).json({ message: "regNumber is required." });
  }

  try {
    const data = await listStudentAssessmentDashboard({
      regNumber,
      email,
      department,
      semester,
      year,
      subjectId,
    });

    return res.status(200).json(data);
  } catch (err) {
    console.error("Error loading student assessment dashboard:", err);
    return res.status(500).json({ message: err.message || "Could not load assessment dashboard." });
  }
});

app.post("/lms/assessment/faculty/dashboard", async (req, res) => {
  const body = req.body || {};
  const email = normalizeFacultyEmail(body.email);
  const subjectId = String(body.subjectId || "").trim();

  if (!email) {
    return res.status(400).json({ message: "Faculty email is required." });
  }

  try {
    const data = await listFacultyAssessmentDashboard({
      email,
      subjectId,
    });

    return res.status(200).json(data);
  } catch (err) {
    console.error("Error loading faculty assessment dashboard:", err);
    return res.status(500).json({ message: err.message || "Could not load faculty assessment dashboard." });
  }
});

app.post("/lms/assessment/faculty/create", async (req, res) => {
  const body = req.body || {};
  const email = normalizeFacultyEmail(body.email);
  const subjectId = String(body.subjectId || "").trim();
  const title = String(body.title || "").trim();
  const type = String(body.type || "").trim();
  const maxMarks = body.maxMarks;
  const date = String(body.date || "").trim();

  if (!email || !subjectId || !title || !type || typeof maxMarks === "undefined" || !date) {
    return res.status(400).json({ message: "email, subjectId, title, type, maxMarks, and date are required." });
  }

  try {
    const assessment = await createAssessment({
      facultyEmail: email,
      subjectId,
      title,
      type,
      maxMarks,
      date,
    });

    return res.status(201).json({
      message: "Assessment created successfully.",
      assessment,
    });
  } catch (err) {
    console.error("Error creating assessment:", err);
    return res.status(500).json({ message: err.message || "Could not create assessment." });
  }
});

app.post("/lms/assessment/faculty/mark", async (req, res) => {
  const body = req.body || {};
  const email = normalizeFacultyEmail(body.email);
  const assessmentId = String(body.assessmentId || "").trim();
  const studentId = String(body.studentId || "").trim();
  const marksObtained = body.marksObtained;
  const remarks = String(body.remarks || "").trim();

  if (!email || !assessmentId || !studentId) {
    return res.status(400).json({ message: "email, assessmentId, and studentId are required." });
  }

  try {
    const mark = await upsertAssessmentMark({
      facultyEmail: email,
      assessmentId,
      studentId,
      marksObtained,
      remarks,
    });

    return res.status(200).json({
      message: "Assessment mark saved successfully.",
      mark,
    });
  } catch (err) {
    console.error("Error saving assessment marks:", err);
    return res.status(500).json({ message: err.message || "Could not save assessment mark." });
  }
});

app.get("/health", async (req, res) => {
  const startedAt = Date.now();
  const emailHealth = getEmailHealth();
  const registrationsHealth = await checkRegistrationsHealth();
  const ok = registrationsHealth.ok;

  return res.status(ok ? 200 : 503).json({
    ok,
    service: "svu-assessment",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    responseMs: Date.now() - startedAt,
    otp: {
      ttlSeconds: Math.ceil(OTP_TTL_MS / 1000),
      clockSkewSeconds: Math.ceil(OTP_CLOCK_SKEW_MS / 1000),
    },
    email: emailHealth,
    supabase: {
      registrations: registrationsHealth,
    },
  });
});

// Backwards compatibility and proper signup route redirection.
app.get(["/SVUsignup.html", "/SVUassessment.html", "/signup"], (req, res) => {
  res.redirect(302, "/SVUsingup.html");
});

app.post("/signup", async (req, res) => {
  const body = req.body || {};
  const email = getSubmittedEmail(body);
  const regNumber = String(body.regNumber || "").trim();

  if (!regNumber || !email || !body.password) {
    return res.status(400).json({ message: "regNumber, email and password are required" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  // Validate password requirements
  const passwordValidation = validatePassword(body.password);
  if (!passwordValidation.isValid) {
    let errors = [];
    if (!passwordValidation.hasLowercase) errors.push("lowercase letter");
    if (!passwordValidation.hasNumber) errors.push("number");
    if (!passwordValidation.hasSpecial) errors.push("special character (!@#$%^&*)");
    if (!passwordValidation.hasNoUppercase) errors.push("no uppercase letters");
    
    return res.status(400).json({ 
      message: `Password must contain: ${errors.join(", ")}` 
    });
  }

  try {
    const existing = await findRegistration(email);
    if (existing) {
      return res.status(409).json({ message: "Account already exists for this email" });
    }

    const existingReg = await findRegistration(regNumber);
    if (existingReg) {
      return res.status(409).json({ message: "Account already exists for this registration number" });
    }

    // Auto-fill from student table if available
    const studentProfile = await getStudentProfile(regNumber);
    const studentNameFromDb = studentProfile?.studentName || "";
    const admitNumberFromDb = studentProfile?.admitNumber || "";

    const hashedPassword = await hashPassword(body.password);

    // Compute semester if the client did not provide a friendly value.
    const semesterNumber = calculateSemesterFromRegNumber(regNumber) || null;
    const semesterLabel = body.semester ? String(body.semester).trim() : semesterNumber ? formatSemesterLabel(semesterNumber) : "";
    const normalizedSemester = normalizeSemesterValue(semesterLabel || body.semester || "");
    const semesterValue = normalizedSemester ? Number(normalizedSemester) : null;
    const yearValueMatch = String(body.year || "").match(/\d+/);
    const yearValue = yearValueMatch ? Number(yearValueMatch[0]) : null;

    const savedRegistration = await saveRegistration({
      email,
      password: hashedPassword,
      regnumber: regNumber,
      registrationdate: new Date().toISOString(),
      studentname: body.studentName || studentNameFromDb || "",
      admitnumber: body.admitNumber || admitNumberFromDb || "",
      department: body.course || studentProfile?.course || "",
      year: yearValue,
      semester: semesterValue,
      verified: false,
      otpcode: null,
      otpexpiry: null,
    });

    if (!savedRegistration) {
      console.error("Signup failure: registrations row was not saved", { email, regNumber });
      return res.status(500).json({ message: "Could not save registration data to Supabase." });
    }

    return res.status(201).json({
      message: "Signup successful. Your data has been stored in Supabase.",
      profile: {
        email,
        regNumber,
        studentName: savedRegistration.studentname || body.studentName || studentNameFromDb || "",
        admitNumber: savedRegistration.admitnumber || body.admitNumber || admitNumberFromDb || "",
        course: savedRegistration.department || body.course || studentProfile?.course || "",
        year: savedRegistration.year ? formatStudyYearLabel(Number(savedRegistration.year)) : (body.year || ""),
        semester: savedRegistration.semester ? formatSemesterLabel(Number(savedRegistration.semester)) : semesterLabel,
      },
    });
  } catch (err) {
    console.error("Error during signup:", err);
    return res.status(500).json({ message: "Error creating account" });
  }
});

app.post("/signin", async (req, res) => {
  const body = req.body || {};
  const regNumber = String(body.regNumber || "").trim();
  const email = getSubmittedEmail(body);

  if (!regNumber || !email || !body.password) {
    return res.status(400).json({ message: "regNumber, email and password are required" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  try {
    const registration = await findRegistration(email);
    if (!registration) {
      return res.status(401).json({ message: "No account found for this email. Please create an account first." });
    }

    const storedRegNumber = String(registration.regnumber || registration.regNumber || "").trim();
    if (storedRegNumber !== regNumber) {
      console.error("Login failure: registration number mismatch", { email, suppliedRegNumber: regNumber, storedRegNumber });
      return res.status(401).json({ message: "Registration number does not match this email." });
    }

    const isMatch = await compareStoredPassword(registration.password, body.password);
    if (!isMatch) {
      console.error("Login failure: incorrect password", { email, regNumber });
      return res.status(401).json({ message: "Incorrect password" });
    }

    const studentProfile = await getStudentProfile(storedRegNumber);

    const profileData = buildProfileResponse(registration, studentProfile);

    return res.status(200).json({
      message: "Sign in successful",
      studentName: profileData.profile.studentName || "",
      ...profileData,
    });
  } catch (err) {
    console.error("Error during signin:", err);
    return res.status(500).json({ message: "Error during sign in" });
  }
});

app.all("/profile", async (req, res) => {
  const body = req.body || {};
  const token = getSubmittedToken(body, req);
  let regNumber = (body.regNumber || req.query.regNumber || "").toString().trim();
  let email = getSubmittedEmail(body) || (req.query.email || "").toString().trim();

  try {
    if (!email && token) {
      const tokenData = parseProfileToken(token);
      if (tokenData?.payload?.email) {
        email = tokenData.payload.email;
      }
      if (tokenData?.payload?.regNumber) {
        regNumber = tokenData.payload.regNumber;
      }
    }

    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }

    const registration = await findRegistration(email);
    if (!registration) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    if (token) {
      const resolved = resolveProfileFromToken(token, [registration]);
      if (!resolved) {
        return res.status(401).json({ message: "Invalid or expired profile token" });
      }
    }

    const studentProfile = await getStudentProfile(registration.regnumber || regNumber);
    const profileData = buildProfileResponse(registration, studentProfile);

    return res.status(200).json({
      message: "Profile loaded successfully",
      ...profileData,
    });
  } catch (err) {
    console.error("Error loading profile:", err);
    return res.status(500).json({ message: "Error loading profile" });
  }
});

app.post("/logout", (req, res) => {
  return res.status(200).json({
    message: "Logout successful",
  });
});

app.post("/profile/photo", async (req, res) => {
  const body = req.body || {};
  const imageData = (body.imageData || "").toString().trim();
  const token = getSubmittedToken(body, req);
  let email = getSubmittedEmail(body).toLowerCase();

  if (!imageData) {
    return res.status(400).json({ message: "imageData is required" });
  }

  if (!isSafeImageDataUrl(imageData)) {
    return res.status(400).json({
      message: "Profile photo must be a PNG, JPG, JPEG, or WEBP image under 2 MB.",
    });
  }

  try {
    if (!email && token) {
      const tokenData = parseProfileToken(token);
      if (tokenData?.payload?.email) {
        email = tokenData.payload.email;
      }
    }

    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }

    const registration = await findRegistration(email);
    if (!registration) {
      return res.status(401).json({ message: "Invalid email" });
    }

    if (token) {
      const resolved = resolveProfileFromToken(token, [registration]);
      if (!resolved) {
        return res.status(401).json({ message: "Invalid or expired profile token" });
      }
    }

    const updated = await saveRegistration({
      ...registration,
      profilephoto: imageData,
    });

    if (!updated) {
      return res.status(500).json({ message: "Error saving profile photo" });
    }

    return res.status(200).json({
      message: "Profile photo updated successfully",
      profilePhoto: imageData,
      profileToken: createProfileToken(updated),
    });
  } catch (err) {
    console.error("Error updating profile photo:", err);
    return res.status(500).json({ message: "Error saving profile photo" });
  }
});

app.post("/forgot-password", async (req, res) => {
  const body = req.body || {};
  const email = getSubmittedEmail(body);
  const traceId = createTraceId("forgot");
  const startedAt = Date.now();

  logOtpFlow(traceId, "request_received", { email });

  if (!email) {
    logOtpFlow(traceId, "request_rejected", { reason: "missing_email" });
    return res.status(400).json({ message: "Email is required" });
  }

  if (!isEmailConfigured()) {
    logOtpFlow(traceId, "request_rejected", { email, reason: "email_service_not_configured" });
    return res.status(500).json({
      message: "Email service is not configured. Please contact administrator.",
    });
  }

  try {
    // Check if registration exists
    const registration = await findRegistration(email);

    if (!registration) {
      logOtpFlow(traceId, "account_not_found", { email });
      return res.status(404).json({ message: "No account found with this email" });
    }

    if (!registration.id) {
      logOtpFlow(traceId, "request_failed", { email, reason: "missing_registration_id" });
      return res.status(500).json({ message: "Account record is missing an id. Cannot store OTP." });
    }

    const { otp, expiresAtMs, expiresAtIso } = createOtpPayload();

    const otpPatch = buildOtpPersistPatch(registration, otp, expiresAtIso);
    const saved = await updateRegistrationById(registration.id, otpPatch);
    if (!saved) {
      logOtpFlow(traceId, "otp_store_failed", { email, registrationId: registration.id });
      return res.status(500).json({ message: "Could not store OTP. Check database columns and try again." });
    }

    logOtpFlow(traceId, "otp_stored", {
      email,
      registrationId: registration.id,
      expiresAt: expiresAtIso,
      dbMs: Date.now() - startedAt,
    });

    await sendOtpEmail(email, otp);

    logOtpFlow(traceId, "otp_sent", {
      email,
      registrationId: registration.id,
      totalMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      message: "OTP sent to your email.",
      expiresAt: new Date(expiresAtMs).toISOString(),
      otpTtlSeconds: Math.ceil(OTP_TTL_MS / 1000),
    });
  } catch (err) {
    console.error("Error sending OTP email:", err);
    logOtpFlow(traceId, "request_failed", {
      email,
      code: err && err.code ? String(err.code) : "",
      message: err && err.message ? err.message : "unknown_error",
      totalMs: Date.now() - startedAt,
    });
    const code = err && err.code ? String(err.code) : "";
    let responseMessage = "Unable to send OTP email right now. Please try again later.";
    if (code === "EAUTH") {
      responseMessage =
        "SMTP authentication failed. Please check SMTP_USER and SMTP_PASS (use Gmail App Password).";
    } else if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
      responseMessage =
        `SMTP connection failed (${code}). Check internet/firewall and SMTP host/port settings.`;
    } else if (code) {
      responseMessage = `SMTP error (${code}). Please verify email configuration.`;
    }

    return res.status(500).json({ message: responseMessage });
  }
});

app.get("/forgot-password", (req, res) => {
  return res.status(200).json({
    message: "Use POST /forgot-password with { email } to request a password reset OTP.",
  });
});

app.post("/resend-otp", async (req, res) => {
  const body = req.body || {};
  const email = getSubmittedEmail(body);
  const traceId = createTraceId("resend");
  const startedAt = Date.now();

  logOtpFlow(traceId, "request_received", { email });

  if (!email) {
    logOtpFlow(traceId, "request_rejected", { reason: "missing_email" });
    return res.status(400).json({ message: "Email is required" });
  }

  if (!isEmailConfigured()) {
    logOtpFlow(traceId, "request_rejected", { email, reason: "email_service_not_configured" });
    return res.status(500).json({
      message: "Email service is not configured. Please contact administrator.",
    });
  }

  try {
    const registration = await findRegistration(email);
    if (!registration) {
      logOtpFlow(traceId, "account_not_found", { email });
      return res.status(404).json({ message: "No account found with this email" });
    }

    if (!registration.id) {
      logOtpFlow(traceId, "request_failed", { email, reason: "missing_registration_id" });
      return res.status(500).json({ message: "Account record is missing an id. Cannot store OTP." });
    }

    const { otp, expiresAtMs, expiresAtIso } = createOtpPayload();

    const otpPatch = buildOtpPersistPatch(registration, otp, expiresAtIso);
    const saved = await updateRegistrationById(registration.id, otpPatch);
    if (!saved) {
      logOtpFlow(traceId, "otp_store_failed", { email, registrationId: registration.id });
      return res.status(500).json({ message: "Could not store OTP. Check database columns and try again." });
    }

    logOtpFlow(traceId, "otp_stored", {
      email,
      registrationId: registration.id,
      expiresAt: expiresAtIso,
      dbMs: Date.now() - startedAt,
    });

    await sendOtpEmail(email, otp);

    logOtpFlow(traceId, "otp_sent", {
      email,
      registrationId: registration.id,
      totalMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      message: "New OTP sent to your email.",
      expiresAt: new Date(expiresAtMs).toISOString(),
      otpTtlSeconds: Math.ceil(OTP_TTL_MS / 1000),
    });
  } catch (err) {
    console.error("Error resending OTP email:", err);
    logOtpFlow(traceId, "request_failed", {
      email,
      code: err && err.code ? String(err.code) : "",
      message: err && err.message ? err.message : "unknown_error",
      totalMs: Date.now() - startedAt,
    });
    const code = err && err.code ? String(err.code) : "";
    let responseMessage = "Unable to resend OTP. Please try again later.";
    if (code === "EAUTH") {
      responseMessage =
        "SMTP authentication failed. Please check SMTP_USER and SMTP_PASS (use Gmail App Password).";
    } else if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
      responseMessage =
        `SMTP connection failed (${code}). Check internet/firewall and SMTP host/port settings.`;
    } else if (code) {
      responseMessage = `SMTP error (${code}). Please verify email configuration.`;
    }
    return res.status(500).json({ message: responseMessage });
  }
});

app.post("/reset-password", async (req, res) => {
  const body = req.body || {};
  const email = getSubmittedEmail(body);
  const otp = (body.otp || "").toString().trim();
  const newPassword = (body.newPassword || "").toString();
  const traceId = createTraceId("reset");
  const startedAt = Date.now();

  logOtpFlow(traceId, "request_received", {
    email,
    otpLength: otp.length,
    hasNewPassword: Boolean(newPassword),
  });

  if (!email || !otp || !newPassword) {
    logOtpFlow(traceId, "request_rejected", {
      email,
      reason: "missing_required_fields",
      otpLength: otp.length,
      hasNewPassword: Boolean(newPassword),
    });
    return res.status(400).json({ message: "email, otp and newPassword are required" });
  }

  try {
    // Find registration
    const registration = await findRegistration(email);

    if (!registration) {
      logOtpFlow(traceId, "account_not_found", { email });
      return res.status(404).json({ message: "No account found with this email" });
    }

    if (!registration.id) {
      logOtpFlow(traceId, "request_failed", { email, reason: "missing_registration_id" });
      return res.status(500).json({ message: "Account record is missing an id. Cannot update password." });
    }

    const storedOtp = readStoredOtpCode(registration);
    const expiryRaw = readStoredOtpExpiry(registration);

    if (!storedOtp || expiryRaw == null || expiryRaw === "") {
      logOtpFlow(traceId, "otp_missing", { email, registrationId: registration.id });
      return res.status(400).json({ message: "No OTP request found. Please request a new OTP." });
    }

    const otpExpiryMs = parseOtpExpiryMs(expiryRaw);
    if (!Number.isFinite(otpExpiryMs)) {
      logOtpFlow(traceId, "otp_invalid_data", {
        email,
        registrationId: registration.id,
        expiryRaw: String(expiryRaw),
      });
      return res.status(400).json({ message: "OTP data is invalid. Please request a new OTP." });
    }

    if (otpExpiryMs + OTP_CLOCK_SKEW_MS < Date.now()) {
      logOtpFlow(traceId, "otp_expired", {
        email,
        registrationId: registration.id,
        expiryRaw: String(expiryRaw),
        expiryMs: otpExpiryMs,
        nowMs: Date.now(),
      });
      return res.status(400).json({ message: "OTP has expired. Please request a new OTP." });
    }

    if (storedOtp !== otp) {
      logOtpFlow(traceId, "otp_mismatch", {
        email,
        registrationId: registration.id,
      });
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // Validate new password
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      let errors = [];
      if (!passwordValidation.hasLowercase) errors.push("lowercase letter");
      if (!passwordValidation.hasNumber) errors.push("number");
      if (!passwordValidation.hasSpecial) errors.push("special character (!@#$%^&*)");
      if (!passwordValidation.hasNoUppercase) errors.push("no uppercase letters");

      return res.status(400).json({
        message: `Password must contain: ${errors.join(", ")}`
      });
    }

    logOtpFlow(traceId, "password_validated", {
      email,
      registrationId: registration.id,
      elapsedMs: Date.now() - startedAt,
    });

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    const updatedRegistration = await persistUpdatedPassword(registration, hashedPassword);
    if (!updatedRegistration) {
      logOtpFlow(traceId, "password_persist_failed", {
        email,
        registrationId: registration.id,
        totalMs: Date.now() - startedAt,
      });
      return res.status(500).json({ message: "Could not update password. Please try again." });
    }

    logOtpFlow(traceId, "password_reset_success", {
      email,
      registrationId: registration.id,
      totalMs: Date.now() - startedAt,
    });

    const profile = buildProfileResponse(updatedRegistration, null);
    return res.status(200).json({
      message: "Password reset successful. You are now signed in.",
      ...profile
    });
  } catch (err) {
    console.error("Error during password reset:", err);
    logOtpFlow(traceId, "request_failed", {
      email,
      code: err && err.code ? String(err.code) : "",
      message: err && err.message ? err.message : "unknown_error",
      totalMs: Date.now() - startedAt,
    });
    return res.status(500).json({ message: "Error resetting password" });
  }
});

app.use((err, req, res, next) => {
  if (!err) {
    return next();
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      message: "Profile photo upload is too large. Please use an image under 2 MB.",
    });
  }

  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, "body")) {
    return res.status(400).json({
      message: "Request body is not valid JSON.",
    });
  }

  return next(err);
});

app.use((req, res) => {
  return res.status(404).json({ message: "Route not found" });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the other server or run this app with a different port, for example: $env:PORT=3002; node server.js`
      );
      return;
    }

    console.error("Server failed to start:", err);
  });
}

module.exports = app;

