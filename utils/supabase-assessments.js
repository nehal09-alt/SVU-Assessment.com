const crypto = require("crypto");
const { supabaseAdmin } = require("./supabase-client");
const { getStudentProfile } = require("./supabase-student-data");
const { findFacultyByEmail } = require("./supabase-faculty");
const { getCoursesFor } = require("./supabase-courses");

const PROFILE_NAMESPACE = process.env.LMS_PROFILE_NAMESPACE || "4f34f0cc-4d0f-4c51-9b9b-2e8a3e41c923";

function hashToUuid(value) {
  const hex = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8).join(""),
    hex.slice(8, 12).join(""),
    hex.slice(12, 16).join(""),
    hex.slice(16, 20).join(""),
    hex.slice(20, 32).join(""),
  ].join("-");
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

function toIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function deriveSubjectQuery(studentProfile, overrides = {}) {
  const department = String(overrides.department || studentProfile.department || "").trim();
  const semester = normalizeSemesterValue(overrides.semester || studentProfile.semester);
  const year = String(overrides.year || studentProfile.year || "").trim()
    || String(deriveStudyYearFromSemester(semester) || "");

  return {
    department,
    semester,
    year,
  };
}

function isMissingProfilesTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("public.profiles") ||
    message.includes("relation \"profiles\" does not exist") ||
    message.includes("could not find the table") ||
    message.includes("table 'profiles'")
  );
}

function createSyntheticProfile({ role, name, email = "", regNumber = "", department = "", semester = "", year = "" }) {
  const normalizedRole = role === "faculty" ? "faculty" : "student";
  return {
    id: hashToUuid(`${PROFILE_NAMESPACE}:${normalizedRole}:${String(email || "").trim().toLowerCase()}:${String(regNumber || "").trim().toUpperCase()}`),
    name: String(name || (normalizedRole === "faculty" ? "Faculty Member" : "Student")).trim(),
    department: String(department || "").trim(),
    semester: normalizeSemesterValue(semester),
    year: String(year || "").trim(),
    role: normalizedRole,
  };
}

async function ensureProfile({ role, name, email = "", regNumber = "", department = "", semester = "", year = "" }) {
  const normalizedRole = role === "faculty" ? "faculty" : "student";
  const seed = normalizedRole === "faculty"
    ? `faculty:${String(email || "").trim().toLowerCase()}`
    : `student:${String(regNumber || "").trim().toUpperCase()}:${String(email || "").trim().toLowerCase()}`;

  const payload = {
    id: hashToUuid(`${PROFILE_NAMESPACE}:${seed}`),
    name: String(name || "").trim() || (normalizedRole === "faculty" ? "Faculty Member" : "Student"),
    department: String(department || "").trim(),
    semester: normalizeSemesterValue(semester),
    year: String(year || "").trim(),
    role: normalizedRole,
  };

  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select("id, name, department, semester, year, role")
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (err) {
    if (isMissingProfilesTableError(err)) {
      console.warn("Supabase profiles table unavailable; falling back to synthetic profile.", err.message);
      return createSyntheticProfile({ role, name, email, regNumber, department, semester, year });
    }
    throw new Error(err.message || "Could not ensure profile.");
  }
}

async function fetchSubjectsForStudent(studentProfile, overrides = {}) {
  const { department, semester, year } = deriveSubjectQuery(studentProfile, overrides);

  let subjectQuery = supabaseAdmin
    .from("subjects")
    .select("id, name, department, semester, year, faculty_id")
    .eq("department", department)
    .eq("semester", semester);

  if (year) {
    subjectQuery = subjectQuery.eq("year", year);
  }

  const { data, error } = await subjectQuery.order("name", { ascending: true });
  if (error) {
    throw new Error(error.message || "Could not load student subjects.");
  }

  if (Array.isArray(data) && data.length > 0) {
    return data;
  }

  const courseRows = getCoursesFor(department, semester);
  const subjectNames = [...new Set(courseRows.map((row) => String(row.subject || "").trim()).filter(Boolean))];
  if (subjectNames.length === 0) {
    return [];
  }

  const { data: fallbackSubjects, error: fallbackError } = await supabaseAdmin
    .from("subjects")
    .select("id, name, department, semester, year, faculty_id")
    .eq("department", department)
    .eq("semester", semester)
    .in("name", subjectNames)
    .order("name", { ascending: true });

  if (fallbackError) {
    throw new Error(fallbackError.message || "Could not load student subjects.");
  }

  return fallbackSubjects || [];
}

async function fetchAssessmentsForSubjects(subjectIds) {
  const ids = Array.isArray(subjectIds) ? subjectIds.filter(Boolean) : [];
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("assessments")
    .select("id, subject_id, title, type, max_marks, date, created_at")
    .in("subject_id", ids)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(error.message || "Could not load assessments.");
  }

  return data || [];
}

async function fetchMarksForStudent(studentId, assessmentIds) {
  const ids = Array.isArray(assessmentIds) ? assessmentIds.filter(Boolean) : [];
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("assessment_marks")
    .select("id, student_id, assessment_id, marks_obtained, remarks")
    .eq("student_id", studentId)
    .in("assessment_id", ids);

  if (error) {
    throw new Error(error.message || "Could not load assessment marks.");
  }

  return data || [];
}

async function listStudentAssessmentDashboard({ regNumber, email = "", department = "", semester = "", year = "", subjectId = "" }) {
  const studentProfile = await getStudentProfile(regNumber);
  if (!studentProfile) {
    throw new Error("Student profile not found.");
  }

  const resolvedSemester = normalizeSemesterValue(semester || studentProfile.semester);
  const resolvedYear = String(year || deriveStudyYearFromSemester(resolvedSemester) || "");
  const resolvedDepartment = String(department || studentProfile.course || "").trim();
  const lmsProfile = await ensureProfile({
    role: "student",
    name: studentProfile.studentName,
    email,
    regNumber,
    department: resolvedDepartment,
    semester: resolvedSemester,
    year: resolvedYear,
  });

  const subjects = await fetchSubjectsForStudent({
    department: resolvedDepartment,
    semester: resolvedSemester,
    year: resolvedYear,
  });

  const filteredSubjects = subjectId
    ? subjects.filter((subject) => subject.id === subjectId)
    : subjects;

  const assessments = await fetchAssessmentsForSubjects(filteredSubjects.map((subject) => subject.id));
  const marks = await fetchMarksForStudent(lmsProfile.id, assessments.map((assessment) => assessment.id));
  const marksMap = new Map(marks.map((item) => [item.assessment_id, item]));

  return {
    profile: {
      id: lmsProfile.id,
      name: studentProfile.studentName,
      department: resolvedDepartment,
      semester: resolvedSemester,
      year: resolvedYear,
      regNumber,
      email,
    },
    subjects,
    assessments: assessments.map((assessment) => {
      const mark = marksMap.get(assessment.id) || null;
      return {
        ...assessment,
        result: mark,
        status: mark && mark.marks_obtained !== null && mark.marks_obtained !== undefined ? "evaluated" : "pending",
      };
    }),
  };
}

async function fetchFacultySubjects(facultyProfileId, allowedSubjects = [], subjectId = "") {
  let subjectQuery = supabaseAdmin
    .from("subjects")
    .select("id, name, department, semester, year, faculty_id")
    .eq("faculty_id", facultyProfileId);

  if (subjectId) {
    subjectQuery = subjectQuery.eq("id", subjectId);
  } else if (Array.isArray(allowedSubjects) && allowedSubjects.length > 0) {
    subjectQuery = subjectQuery.in("name", allowedSubjects);
  }

  const { data, error } = await subjectQuery.order("name", { ascending: true });
  if (error) {
    throw new Error(error.message || "Could not load faculty subjects.");
  }

  if (Array.isArray(data) && data.length > 0) {
    return data;
  }

  if (Array.isArray(allowedSubjects) && allowedSubjects.length > 0) {
    const { data: fallbackSubjects, error: fallbackError } = await supabaseAdmin
      .from("subjects")
      .select("id, name, department, semester, year, faculty_id")
      .in("name", allowedSubjects)
      .order("name", { ascending: true });

    if (fallbackError) {
      throw new Error(fallbackError.message || "Could not load faculty subjects.");
    }

    return fallbackSubjects || [];
  }

  return [];
}

async function listFacultyAssessmentDashboard({ email, subjectId = "" }) {
  const faculty = await findFacultyByEmail(email);
  if (!faculty || faculty.approved === false) {
    throw new Error("Faculty account not found.");
  }

  const facultyProfile = await ensureProfile({
    role: "faculty",
    name: faculty.name,
    email,
  });

  const allowedSubjects = Array.isArray(faculty.subjects) ? faculty.subjects : [];
  const subjects = await fetchFacultySubjects(facultyProfile.id, allowedSubjects, subjectId);
  const assessments = await fetchAssessmentsForSubjects(subjects.map((subject) => subject.id));
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const { data: marks, error: marksError } = assessmentIds.length === 0
    ? { data: [], error: null }
    : await supabaseAdmin
      .from("assessment_marks")
      .select("id, student_id, assessment_id, marks_obtained, remarks")
      .in("assessment_id", assessmentIds)
      .order("created_at", { ascending: false });

  if (marksError) {
    throw new Error(marksError.message || "Could not load assessment marks.");
  }

  const studentIds = [...new Set((marks || []).map((mark) => mark.student_id).filter(Boolean))];
  let studentProfiles = [];

  if (studentIds.length > 0) {
    const { data, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, name, role")
      .in("id", studentIds);

    if (profileError) {
      if (isMissingProfilesTableError(profileError)) {
        console.warn("Supabase profiles table unavailable; using student names from marks instead.", profileError.message);
      } else {
        throw new Error(profileError.message || "Could not load student profiles.");
      }
    } else {
      studentProfiles = data || [];
    }
  }

  const profileMap = new Map((studentProfiles || []).map((item) => [item.id, item]));
  const marksByAssessment = (marks || []).reduce((acc, mark) => {
    if (!acc[mark.assessment_id]) acc[mark.assessment_id] = [];
    acc[mark.assessment_id].push({
      ...mark,
      student_name: profileMap.get(mark.student_id)?.name || "Student",
    });
    return acc;
  }, {});

  return {
    faculty: {
      id: facultyProfile.id,
      name: facultyProfile.name,
      email,
      role: faculty.role || "faculty",
      subjects: allowedSubjects,
    },
    subjects,
    assessments,
    marks: marks || [],
    marksByAssessment,
  };
}

async function createAssessment({ facultyEmail, subjectId, title, type, maxMarks, date }) {
  const faculty = await findFacultyByEmail(facultyEmail);
  if (!faculty || faculty.approved === false) {
    throw new Error("Faculty account not found.");
  }

  const facultyProfile = await ensureProfile({
    role: "faculty",
    name: faculty.name,
    email: facultyEmail,
  });

  const { data: subject, error: subjectError } = await supabaseAdmin
    .from("subjects")
    .select("id, name, faculty_id")
    .eq("id", subjectId)
    .single();

  if (subjectError || !subject) {
    throw new Error("Subject not found.");
  }

  if (subject.faculty_id && subject.faculty_id !== facultyProfile.id) {
    throw new Error("You can only create assessments for your own subjects.");
  }

  if (!subject.faculty_id && Array.isArray(faculty.subjects) && faculty.subjects.includes(subject.name)) {
    await supabaseAdmin
      .from("subjects")
      .update({ faculty_id: facultyProfile.id })
      .eq("id", subjectId);
  }

  const payload = {
    subject_id: subjectId,
    title: String(title || "").trim(),
    type: String(type || "").trim(),
    max_marks: Number(maxMarks),
    date: toIsoDate(date),
  };

  if (!payload.title || !payload.type || !payload.date || !Number.isFinite(payload.max_marks)) {
    throw new Error("Invalid assessment data.");
  }

  const { data, error } = await supabaseAdmin
    .from("assessments")
    .insert(payload)
    .select("id, subject_id, title, type, max_marks, date, created_at")
    .single();

  if (error) {
    throw new Error(error.message || "Could not create assessment.");
  }

  return data;
}

async function upsertAssessmentMark({ facultyEmail, assessmentId, studentId, marksObtained, remarks }) {
  const faculty = await findFacultyByEmail(facultyEmail);
  if (!faculty || faculty.approved === false) {
    throw new Error("Faculty account not found.");
  }

  const facultyProfile = await ensureProfile({
    role: "faculty",
    name: faculty.name,
    email: facultyEmail,
  });

  const { data: assessment, error: assessmentError } = await supabaseAdmin
    .from("assessments")
    .select("id, subject_id")
    .eq("id", assessmentId)
    .single();

  if (assessmentError || !assessment) {
    throw new Error("Assessment not found.");
  }

  const { data: subject, error: subjectError } = await supabaseAdmin
    .from("subjects")
    .select("id, name, faculty_id")
    .eq("id", assessment.subject_id)
    .single();

  if (subjectError || !subject) {
    throw new Error("Subject not found.");
  }

  if (subject.faculty_id && subject.faculty_id !== facultyProfile.id) {
    throw new Error("You can only manage marks for your own subjects.");
  }

  if (!subject.faculty_id && Array.isArray(faculty.subjects) && faculty.subjects.includes(subject.name)) {
    await supabaseAdmin
      .from("subjects")
      .update({ faculty_id: facultyProfile.id })
      .eq("id", subject.id);
  }

  const payload = {
    student_id: studentId,
    assessment_id: assessmentId,
    marks_obtained: marksObtained === "" || marksObtained === null || typeof marksObtained === "undefined" ? null : Number(marksObtained),
    remarks: String(remarks || "").trim(),
  };

  const { data, error } = await supabaseAdmin
    .from("assessment_marks")
    .upsert(payload, { onConflict: "student_id,assessment_id" })
    .select("id, student_id, assessment_id, marks_obtained, remarks")
    .single();

  if (error) {
    throw new Error(error.message || "Could not save assessment marks.");
  }

  return data;
}

module.exports = {
  createAssessment,
  ensureProfile,
  fetchFacultySubjects,
  fetchSubjectsForStudent,
  listFacultyAssessmentDashboard,
  listStudentAssessmentDashboard,
  normalizeSemesterValue,
  deriveStudyYearFromSemester,
  upsertAssessmentMark,
};
