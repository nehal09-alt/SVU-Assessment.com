const { supabase } = require("./supabase-client");

/**
 * Load all students from Supabase
 */
async function loadStudents() {
  try {
    const { data, error } = await supabase
      .from("students")
      .select("*");

    if (error) {
      console.error("Error loading students from Supabase:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Error loading students:", err);
    return [];
  }
}

/**
 * Find student by registration number
 */
async function findStudentByRegNumber(regNum) {
  try {
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("regnum", regNum)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 means no rows found - that's ok
      console.error("Error finding student:", error);
    }

    return data || null;
  } catch (err) {
    console.error("Error finding student:", err);
    return null;
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

  const semesterNumber = calculateSemesterFromRegNumber(student.regnum || student.regNum || "");
  return {
    studentName: student.name || "Student",
    regNumber: student.regnum,
    admitNumber: String(student.rollnum || student.sno).padStart(3, "0"),
    admitCardNumber: String(student.rollnum || student.sno).padStart(3, "0"),
    course: student.dept || "B.Tech",
    rollNumber: student.rollnum || "",
    dob: student.dob || "",
    gender: student.gender || "",
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
