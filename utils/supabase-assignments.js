const crypto = require("crypto");
const { supabaseAdmin } = require("./supabase-client");

const ASSIGNMENT_BUCKET = process.env.SUPABASE_ASSIGNMENT_BUCKET || "assignment-files";
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

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSubmissionStatus(dueDate, submittedAt) {
  const due = new Date(dueDate || "");
  const submitted = new Date(submittedAt || "");
  if (Number.isNaN(due.getTime()) || Number.isNaN(submitted.getTime())) {
    return "submitted";
  }
  return submitted.getTime() > due.getTime() ? "late" : "submitted";
}

async function ensureProfile({ role, name, email = "", regNumber = "" }) {
  const normalizedRole = role === "faculty" ? "faculty" : "student";
  const identitySeed = normalizedRole === "faculty"
    ? `faculty:${String(email || "").trim().toLowerCase()}`
    : `student:${String(regNumber || "").trim().toUpperCase()}:${String(email || "").trim().toLowerCase()}`;

  const profile = {
    id: hashToUuid(`${PROFILE_NAMESPACE}:${identitySeed}`),
    name: String(name || "").trim() || (normalizedRole === "faculty" ? "Faculty Member" : "Student"),
    role: normalizedRole,
  };

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select("id, name, role")
    .single();

  if (error) {
    throw new Error(error.message || "Could not ensure LMS profile.");
  }

  return data;
}

async function ensureSubject({ name, facultyId }) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName || !facultyId) {
    throw new Error("Subject name and faculty id are required.");
  }

  const subjectId = hashToUuid(`subject:${facultyId}:${normalizedName.toLowerCase()}`);
  const payload = {
    id: subjectId,
    name: normalizedName,
    faculty_id: facultyId,
  };

  const { data, error } = await supabaseAdmin
    .from("subjects")
    .upsert(payload, { onConflict: "id" })
    .select("id, name, faculty_id")
    .single();

  if (error) {
    throw new Error(error.message || "Could not ensure subject.");
  }

  return data;
}

async function createAssignment({ facultyProfile, subjectName, title, description, dueDate }) {
  if (!facultyProfile?.id) {
    throw new Error("Faculty profile is required.");
  }

  const subject = await ensureSubject({
    name: subjectName,
    facultyId: facultyProfile.id,
  });

  const assignmentPayload = {
    subject_id: subject.id,
    title: String(title || "").trim(),
    description: String(description || "").trim(),
    due_date: toIsoDate(dueDate),
  };

  if (!assignmentPayload.title || !assignmentPayload.due_date) {
    throw new Error("Assignment title and due date are required.");
  }

  const { data, error } = await supabaseAdmin
    .from("assignments")
    .insert(assignmentPayload)
    .select("id, subject_id, title, description, due_date, created_at")
    .single();

  if (error) {
    throw new Error(error.message || "Could not create assignment.");
  }

  return {
    ...data,
    subject,
  };
}

async function uploadSubmissionFile({ studentId, assignmentId, fileName, contentType, fileBuffer }) {
  const safeFileName = String(fileName || "submission")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-");
  const filePath = `${studentId}/${assignmentId}/${Date.now()}-${safeFileName}`;

  const { error } = await supabaseAdmin.storage
    .from(ASSIGNMENT_BUCKET)
    .upload(filePath, fileBuffer, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    throw new Error(error.message || "Could not upload assignment file.");
  }

  const { data } = supabaseAdmin.storage.from(ASSIGNMENT_BUCKET).getPublicUrl(filePath);
  return {
    filePath,
    fileUrl: data?.publicUrl || "",
  };
}

async function submitAssignment({
  studentProfile,
  assignmentId,
  fileName,
  fileType,
  fileBase64,
  notes = "",
}) {
  if (!studentProfile?.id) {
    throw new Error("Student profile is required.");
  }

  if (!assignmentId || !fileName || !fileBase64) {
    throw new Error("Assignment id and file are required.");
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from("assignments")
    .select("id, due_date")
    .eq("id", assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found.");
  }

  const existingSubmission = await supabaseAdmin
    .from("submissions")
    .select("id")
    .eq("student_id", studentProfile.id)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (existingSubmission.data?.id) {
    throw new Error("Assignment was already submitted. Resubmission is disabled.");
  }

  const fileBuffer = Buffer.from(String(fileBase64), "base64");
  const uploaded = await uploadSubmissionFile({
    studentId: studentProfile.id,
    assignmentId,
    fileName,
    contentType: fileType,
    fileBuffer,
  });

  const submittedAt = new Date().toISOString();
  const status = normalizeSubmissionStatus(assignment.due_date, submittedAt);
  const payload = {
    student_id: studentProfile.id,
    assignment_id: assignmentId,
    file_url: uploaded.fileUrl,
    status,
    submitted_at: submittedAt,
    student_notes: String(notes || "").trim(),
    storage_path: uploaded.filePath,
  };

  const { data, error } = await supabaseAdmin
    .from("submissions")
    .insert(payload)
    .select("id, assignment_id, file_url, marks, remarks, status, submitted_at, student_notes")
    .single();

  if (error) {
    throw new Error(error.message || "Could not save assignment submission.");
  }

  return data;
}

async function gradeSubmission({ submissionId, facultyProfileId, marks, remarks }) {
  const { data: ownedSubmission, error: ownershipError } = await supabaseAdmin
    .from("submissions")
    .select("id, assignment:assignments!inner(id, subject:subjects!inner(id, faculty_id))")
    .eq("id", submissionId)
    .single();

  const ownerFacultyId = ownedSubmission?.assignment?.subject?.faculty_id;
  if (ownershipError || !ownedSubmission || ownerFacultyId !== facultyProfileId) {
    throw new Error("You can only grade submissions for your own subjects.");
  }

  const payload = {
    marks: marks === "" || marks === null || typeof marks === "undefined" ? null : Number(marks),
    remarks: String(remarks || "").trim(),
  };

  const { data, error } = await supabaseAdmin
    .from("submissions")
    .update(payload)
    .eq("id", submissionId)
    .select("id, marks, remarks")
    .single();

  if (error) {
    throw new Error(error.message || "Could not update grading.");
  }

  return data;
}

async function listStudentDashboard({
  studentProfileId,
  allowedSubjectNames = [],
  subjectId = "",
}) {
  const safeSubjectNames = Array.isArray(allowedSubjectNames)
    ? allowedSubjectNames.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  let subjectQuery = supabaseAdmin
    .from("subjects")
    .select("id, name, faculty_id");

  if (subjectId) {
    subjectQuery = subjectQuery.eq("id", subjectId);
  } else if (safeSubjectNames.length > 0) {
    subjectQuery = subjectQuery.in("name", safeSubjectNames);
  }

  const { data: subjects, error: subjectError } = await subjectQuery.order("name");
  if (subjectError) {
    throw new Error(subjectError.message || "Could not load subjects.");
  }

  const subjectIds = (subjects || []).map((item) => item.id);
  if (subjectIds.length === 0) {
    return {
      subjects: [],
      assignments: [],
    };
  }

  const { data: assignments, error: assignmentError } = await supabaseAdmin
    .from("assignments")
    .select("id, subject_id, title, description, due_date, created_at")
    .in("subject_id", subjectIds)
    .order("due_date", { ascending: true });

  if (assignmentError) {
    throw new Error(assignmentError.message || "Could not load assignments.");
  }

  const assignmentIds = (assignments || []).map((item) => item.id);
  const { data: submissions, error: submissionError } = assignmentIds.length === 0
    ? { data: [], error: null }
    : await supabaseAdmin
      .from("submissions")
      .select("id, student_id, assignment_id, file_url, marks, remarks, status, submitted_at, student_notes")
      .eq("student_id", studentProfileId)
      .in("assignment_id", assignmentIds);

  if (submissionError) {
    throw new Error(submissionError.message || "Could not load submissions.");
  }

  const submissionsByAssignmentId = new Map((submissions || []).map((item) => [item.assignment_id, item]));
  return {
    subjects: subjects || [],
    assignments: (assignments || []).map((assignment) => ({
      ...assignment,
      submission: submissionsByAssignmentId.get(assignment.id) || null,
    })),
  };
}

async function listFacultyDashboard({ facultyProfileId, allowedSubjects = [], subjectId = "" }) {
  let subjectQuery = supabaseAdmin
    .from("subjects")
    .select("id, name, faculty_id")
    .eq("faculty_id", facultyProfileId);

  if (subjectId) {
    subjectQuery = subjectQuery.eq("id", subjectId);
  } else if (Array.isArray(allowedSubjects) && allowedSubjects.length > 0) {
    subjectQuery = subjectQuery.in("name", allowedSubjects);
  }

  const { data: subjects, error: subjectError } = await subjectQuery.order("name");
  if (subjectError) {
    throw new Error(subjectError.message || "Could not load faculty subjects.");
  }

  const subjectIds = (subjects || []).map((item) => item.id);
  if (subjectIds.length === 0) {
    return {
      subjects: [],
      assignments: [],
      submissions: [],
    };
  }

  const { data: assignments, error: assignmentError } = await supabaseAdmin
    .from("assignments")
    .select("id, subject_id, title, description, due_date, created_at")
    .in("subject_id", subjectIds)
    .order("created_at", { ascending: false });

  if (assignmentError) {
    throw new Error(assignmentError.message || "Could not load faculty assignments.");
  }

  const assignmentIds = (assignments || []).map((item) => item.id);
  const { data: submissions, error: submissionError } = assignmentIds.length === 0
    ? { data: [], error: null }
    : await supabaseAdmin
      .from("submissions")
      .select("id, student_id, assignment_id, file_url, marks, remarks, status, submitted_at, student_notes")
      .in("assignment_id", assignmentIds)
      .order("submitted_at", { ascending: false });

  if (submissionError) {
    throw new Error(submissionError.message || "Could not load assignment submissions.");
  }

  const studentIds = [...new Set((submissions || []).map((item) => item.student_id).filter(Boolean))];
  const { data: profiles, error: profileError } = studentIds.length === 0
    ? { data: [], error: null }
    : await supabaseAdmin
      .from("profiles")
      .select("id, name, role")
      .in("id", studentIds);

  if (profileError) {
    throw new Error(profileError.message || "Could not load student names.");
  }

  const profileMap = new Map((profiles || []).map((item) => [item.id, item]));
  return {
    subjects: subjects || [],
    assignments: assignments || [],
    submissions: (submissions || []).map((item) => ({
      ...item,
      student_name: profileMap.get(item.student_id)?.name || "Student",
    })),
  };
}

module.exports = {
  ASSIGNMENT_BUCKET,
  createAssignment,
  ensureProfile,
  ensureSubject,
  gradeSubmission,
  listFacultyDashboard,
  listStudentDashboard,
  submitAssignment,
};
