const { supabase, supabaseAdmin } = require("./supabase-client");

function normalizeStudentRecord(student) {
  if (!student || typeof student !== "object") {
    return null;
  }

  const regNumber = student.regnum || student.regNum || student.regNumber || student.registration_number || "";
  const rollNumber = student.rollnum || student.rollNum || student.rollNumber || student.admitNumber || student.sno || "";
  const studentName = student.name || student.studentName || student.full_name || "";
  const course = student.dept || student.department || student.course || "";

  return {
    ...student,
    regNumber: String(regNumber || "").trim(),
    regnum: String(regNumber || "").trim(),
    regNum: String(regNumber || "").trim(),
    rollNumber: String(rollNumber || "").trim(),
    rollnum: String(rollNumber || "").trim(),
    rollNum: String(rollNumber || "").trim(),
    studentName: String(studentName || "").trim(),
    name: String(studentName || "").trim(),
    course: String(course || "").trim(),
    dept: String(course || "").trim(),
  };
}

/**
 * Load all students from Supabase
 */
async function loadStudents() {
  try {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from("students")
      .select("*");

    if (error) {
      console.error("[supabase-student-data] Error loading students from Supabase:", error);
      return [];
    }

    return Array.isArray(data) ? data.map(normalizeStudentRecord).filter(Boolean) : [];
  } catch (err) {
    console.error("[supabase-student-data] Error loading students:", err);
    return [];
  }
}

/**
 * Find student by registration number
 */
async function findStudentByRegNumber(regNum) {
  const normalizedRegNum = String(regNum || "").trim();

  if (!normalizedRegNum) {
    const error = new Error("Registration number is required for student lookup.");
    console.error("[supabase-student-data] Missing registration number.", error.message);
    throw error;
  }

  const client = supabaseAdmin || supabase;
  const hasUrl = Boolean(process.env.SUPABASE_URL);
  const hasSecretKey = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log("[supabase-student-data] Student lookup requested", {
    regNum: normalizedRegNum,
    table: "students",
    column: "regnum",
    hasSupabaseUrl: hasUrl,
    hasSupabaseSecret: hasSecretKey,
  });

  try {
    const { data, error } = await client
      .from("students")
      .select("*")
      .eq("regnum", normalizedRegNum)
      .maybeSingle();

    if (error) {
      console.error("[supabase-student-data] Supabase query error while finding student:", error);
      throw error;
    }

    if (!data) {
      console.warn("[supabase-student-data] Student not found in Supabase:", {
        regNum: normalizedRegNum,
        table: "students",
        column: "regnum",
      });
      return null;
    }

    return normalizeStudentRecord(data);
  } catch (err) {
    console.error("[supabase-student-data] Error finding student:", err);
    throw err;
  }
}

/**
 * Get admit number from student data
 */
async function getAdmitNumber(regNum) {
  const student = await findStudentByRegNumber(regNum);
  return student ? String(student.rollnum || student.sno).padStart(3, "0") : null;
}

/**
 * Get complete student profile
 */
function parseAdmissionYearFromRegNumber(regNumber) {
  if (!regNumber || typeof regNumber !== "string") {
    return null;
  }

  const match = regNumber.match(/20\d{2}/g);
  if (!match || match.length === 0) {
    return null;
  }

  const candidate = Number(match[match.length - 1]);
  return Number.isFinite(candidate) ? candidate : null;
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

function calculateSemesterFromRegNumber(regNumber) {
  const admissionYear = parseAdmissionYearFromRegNumber(regNumber);
  if (!admissionYear) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const yearDiff = Math.max(0, currentYear - admissionYear);
  return Math.max(1, yearDiff * 2);
}

async function getStudentProfile(regNum) {
  const student = await findStudentByRegNumber(regNum);
  if (!student) {
    return null;
  }

  const normalized = normalizeStudentRecord(student);
  const semesterNumber = calculateSemesterFromRegNumber(normalized.regnum || normalized.regNum || "");
  return {
    studentName: normalized.name || "Student",
    regNumber: normalized.regnum || normalized.regNum || "",
    admitNumber: String(normalized.rollnum || normalized.rollNum || normalized.sno || "").padStart(3, "0"),
    admitCardNumber: String(normalized.rollnum || normalized.rollNum || normalized.sno || "").padStart(3, "0"),
    course: normalized.dept || "B.Tech",
    rollNumber: normalized.rollnum || normalized.rollNum || "",
    dob: normalized.dob || "",
    gender: normalized.gender || "",
    semester: semesterNumber ? formatSemesterLabel(semesterNumber) : "",
  };
}

/**
 * Save student data to Supabase
 */
async function saveStudent(studentData) {
  try {
    const { data, error } = await supabase
      .from("students")
      .upsert(studentData, { onConflict: "regNum" })
      .select();

    if (error) {
      console.error("Error saving student:", error);
      return null;
    }

    return data?.[0] || null;
  } catch (err) {
    console.error("Error saving student:", err);
    return null;
  }
}

module.exports = {
  loadStudents,
  findStudentByRegNumber,
  getAdmitNumber,
  getStudentProfile,
  saveStudent,
};
