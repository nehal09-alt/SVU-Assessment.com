const crypto = require("crypto");
const { supabaseAdmin } = require("./supabase-client");

const ASSIGNMENT_BUCKET = process.env.SUPABASE_ASSIGNMENT_BUCKET || "assignment-files";
const SUBMISSION_BUCKET = process.env.SUPABASE_SUBMISSION_BUCKET || "submission-files";
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
  const normalized = String(value || "").trim();
  const match = normalized.match(/\d+/);
  return match ? match[0] : normalized;
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function isMissingTableError(error, tableName) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes(`public.${tableName}`) ||
    message.includes(`relation "${tableName}" does not exist`) ||
    message.includes("could not find the table") ||
    message.includes(`table '${tableName}'`)
  );
}

async function ensureProfile({ role, name, email = "", regNumber = "" }) {
  const normalizedRole = role === "faculty" ? "faculty" : "student";
  const identitySeed = normalizedRole === "faculty"
    ? `faculty:${normalizeString(email).toLowerCase()}`
    : `student:${normalizeString(regNumber).toUpperCase()}:${normalizeString(email).toLowerCase()}`;

  const profile = {
    id: hashToUuid(`${PROFILE_NAMESPACE}:${identitySeed}`),
    name: normalizeString(name) || (normalizedRole === "faculty" ? "Faculty Member" : "Student"),
    role: normalizedRole,
  };

  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .upsert(profile, { onConflict: "id" })
      .select("id, name, role")
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (err) {
    const errMessage = String(err.message || "").toLowerCase();
    if (
      errMessage.includes("public.profiles") ||
      errMessage.includes("relation \"profiles\" does not exist") ||
      errMessage.includes("could not find the table") ||
      errMessage.includes("table 'profiles'")
    ) {
      console.warn("Supabase profiles table is unavailable; using synthetic LMS profile.", err.message);
      return profile;
    }
    throw new Error(err.message || "Could not ensure LMS profile.");
  }
}

async function uploadFileToBucket({ bucket, folderPath, fileName, contentType, fileBuffer }) {
  const safeFileName = normalizeString(fileName || "file")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const filePath = `${folderPath}/${Date.now()}-${safeFileName}`.replace(/\\+/g, "/");

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(filePath, fileBuffer, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    throw new Error(error.message || `Could not upload file to ${bucket}.`);
  }

  return filePath;
}

async function createSignedUrl(bucket, path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Could not generate download link.");
  }

  return data.signedUrl;
}

async function createAssignment({ facultyProfile, subjectName, department, semester, title, description, deadline, maxMarks, fileName, fileType, fileData }) {
  if (!facultyProfile?.id) {
    throw new Error("Faculty profile is required.");
  }

  const assignmentPayload = {
    faculty_id: facultyProfile.id,
    subject: normalizeString(subjectName),
    department: normalizeString(department),
    semester: normalizeSemesterValue(semester),
    title: normalizeString(title),
    description: normalizeString(description),
    deadline: toIsoDate(deadline),
    max_marks: Number(maxMarks) || null,
    status: "active",
  };

  if (!assignmentPayload.subject || !assignmentPayload.department || !assignmentPayload.semester || !assignmentPayload.title || !assignmentPayload.deadline) {
    throw new Error("Subject, department, semester, title, and deadline are required.");
  }

  if (fileData) {
    const fileBuffer = Buffer.from(String(fileData), "base64");
    assignmentPayload.file_url = await uploadFileToBucket({
      bucket: ASSIGNMENT_BUCKET,
      folderPath: `assignments/${facultyProfile.id}`,
      fileName,
      contentType: fileType,
      fileBuffer,
    });
    assignmentPayload.file_name = normalizeString(fileName);
  }

  const { data, error } = await supabaseAdmin
    .from("assignments")
    .insert(assignmentPayload)
    .select("id, faculty_id, title, description, subject, department, semester, file_url, file_name, deadline, max_marks, status, created_at")
    .single();

  if (error) {
    throw new Error(error.message || "Could not create assignment.");
  }

  const downloadUrl = data.file_url ? await createSignedUrl(ASSIGNMENT_BUCKET, data.file_url) : null;
  return {
    ...data,
    download_url: downloadUrl,
  };
}

async function submitAssignment({ studentProfile, assignmentId, fileName, fileType, fileBase64, notes = "" }) {
  if (!studentProfile?.id) {
    throw new Error("Student profile is required.");
  }

  if (!assignmentId || !fileName || !fileBase64) {
    throw new Error("Assignment id and file are required.");
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from("assignments")
    .select("id, deadline")
    .eq("id", assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found.");
  }

  const now = new Date();
  const deadline = assignment.deadline ? new Date(assignment.deadline) : null;
  if (deadline && now.getTime() > deadline.getTime()) {
    throw new Error("The assignment deadline has passed. Resubmission is not allowed.");
  }

  const existingSubmission = await supabaseAdmin
    .from("assignment_submissions")
    .select("id")
    .eq("student_id", studentProfile.id)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (existingSubmission.error) {
    throw new Error(existingSubmission.error.message || "Could not verify existing submission.");
  }

  const fileBuffer = Buffer.from(String(fileBase64), "base64");
  const filePath = await uploadFileToBucket({
    bucket: SUBMISSION_BUCKET,
    folderPath: `submissions/${studentProfile.id}/${assignmentId}`,
    fileName,
    contentType: fileType,
    fileBuffer,
  });

  const payload = {
    assignment_id: assignmentId,
    student_id: studentProfile.id,
    student_reg_no: normalizeString(studentProfile.regNumber || studentProfile.regNo || ""),
    student_name: normalizeString(studentProfile.studentName || studentProfile.name || "Student"),
    file_url: filePath,
    file_name: normalizeString(fileName),
    file_type: normalizeString(fileType),
    submitted_at: new Date().toISOString(),
    status: "submitted",
    student_notes: normalizeString(notes),
  };

  const { data, error } = await supabaseAdmin
    .from("assignment_submissions")
    .upsert(payload, { onConflict: ["assignment_id", "student_id"] })
    .select("id, assignment_id, student_id, student_reg_no, student_name, file_url, file_name, file_type, submitted_at, status, marks, remarks, student_notes, marks_updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "Could not save assignment submission.");
  }

  const downloadUrl = data.file_url ? await createSignedUrl(SUBMISSION_BUCKET, data.file_url) : null;
  return {
    ...data,
    download_url: downloadUrl,
  };
}

async function gradeSubmission({ submissionId, facultyProfileId, marks, remarks }) {
  const { data: ownedSubmission, error: ownershipError } = await supabaseAdmin
    .from("assignment_submissions")
    .select("id, assignment_id, assignment:assignments!inner(id, faculty_id)")
    .eq("id", submissionId)
    .single();

  if (ownershipError || !ownedSubmission || ownedSubmission.assignment?.faculty_id !== facultyProfileId) {
    throw new Error("You can only grade submissions for your own assignments.");
  }

  const payload = {
    marks: marks === "" || marks === null || typeof marks === "undefined" ? null : Number(marks),
    remarks: normalizeString(remarks),
    status: "evaluated",
    marks_updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("assignment_submissions")
    .update(payload)
    .eq("id", submissionId)
    .select("id, assignment_id, student_id, student_reg_no, student_name, file_url, file_name, file_type, submitted_at, status, marks, remarks, student_notes, marks_updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "Could not update grading.");
  }

  const downloadUrl = data.file_url ? await createSignedUrl(SUBMISSION_BUCKET, data.file_url) : null;
  return {
    ...data,
    download_url: downloadUrl,
  };
}

async function listStudentDashboard({ studentProfileId, allowedSubjectNames = [], subjectId = "", subjectName = "", department = "", semester = "" }) {
  const safeSubjectNames = Array.isArray(allowedSubjectNames)
    ? allowedSubjectNames.map((item) => normalizeString(item)).filter(Boolean)
    : [];

  if (safeSubjectNames.length === 0) {
    return { subjects: [], assignments: [] };
  }

  let subjectFilter = safeSubjectNames;
  if (subjectName) {
    subjectFilter = [normalizeString(subjectName)];
  } else if (subjectId) {
    try {
      const { data: subject, error: subjectError } = await supabaseAdmin
        .from("subjects")
        .select("name")
        .eq("id", subjectId)
        .single();

      if (subjectError) {
        if (isMissingTableError(subjectError, "subjects")) {
          console.warn("Supabase subjects table is unavailable; using subjectId as name.", subjectError.message);
          subjectFilter = [normalizeString(subjectId)];
        } else {
          throw new Error(subjectError.message || "Could not resolve subject filter.");
        }
      } else if (!subject) {
        // Fall back to using the raw subjectId string as the name if it is not a UUID-based subjects record.
        subjectFilter = [normalizeString(subjectId)];
      } else {
        subjectFilter = [subject.name];
      }
    } catch (err) {
      if (isMissingTableError(err, "subjects")) {
        console.warn("Supabase subjects table is unavailable; using subjectId as name.", err.message);
        subjectFilter = [normalizeString(subjectId)];
      } else {
        throw err;
      }
    }
  }

  const assignmentQuery = supabaseAdmin
    .from("assignments")
    .select("id, title, description, subject, department, semester, file_url, file_name, deadline, max_marks, status, created_at")
    .in("subject", subjectFilter)
    .or("status.eq.active,deadline.gt.now()");

  if (department) {
    assignmentQuery.eq("department", normalizeString(department));
  }

  if (semester) {
    assignmentQuery.eq("semester", normalizeSemesterValue(semester));
  }

  const { data: assignments, error: assignmentError } = await assignmentQuery.order("deadline", { ascending: true });
  if (assignmentError) {
    throw new Error(assignmentError.message || "Could not load assignments.");
  }

  const assignmentIds = (assignments || []).map((item) => item.id);
  const { data: submissions, error: submissionError } = assignmentIds.length === 0
    ? { data: [], error: null }
    : await supabaseAdmin
      .from("assignment_submissions")
      .select("id, student_id, assignment_id, file_url, file_name, file_type, marks, remarks, status, submitted_at, student_notes")
      .eq("student_id", studentProfileId)
      .in("assignment_id", assignmentIds);

  if (submissionError) {
    throw new Error(submissionError.message || "Could not load submissions.");
  }

  const submissionsByAssignment = new Map((submissions || []).map((item) => [item.assignment_id, item]));
  const enrichedAssignments = await Promise.all((assignments || []).map(async (assignment) => {
    const assignmentDownloadUrl = assignment.file_url ? await createSignedUrl(ASSIGNMENT_BUCKET, assignment.file_url) : null;
    const submission = submissionsByAssignment.get(assignment.id) || null;
    const submissionDownloadUrl = submission?.file_url ? await createSignedUrl(SUBMISSION_BUCKET, submission.file_url) : null;
    return {
      ...assignment,
      download_url: assignmentDownloadUrl,
      submission: submission ? { ...submission, download_url: submissionDownloadUrl } : null,
    };
  }));

  return {
    subjects: safeSubjectNames.map((name) => ({ name })),
    assignments: enrichedAssignments,
  };
}

async function listFacultyDashboard({ facultyProfileId, allowedSubjects = [], subjectId = "" }) {
  let subjects = [];

  try {
    let subjectQuery = supabaseAdmin
      .from("subjects")
      .select("id, name, faculty_id")
      .eq("faculty_id", facultyProfileId);

    if (subjectId) {
      subjectQuery = subjectQuery.eq("id", subjectId);
    } else if (Array.isArray(allowedSubjects) && allowedSubjects.length > 0) {
      subjectQuery = subjectQuery.in("name", allowedSubjects.map(normalizeString));
    }

    const { data, error: subjectError } = await subjectQuery.order("name");
    if (subjectError) {
      if (isMissingTableError(subjectError, "subjects")) {
        console.warn("Supabase subjects table is unavailable; using allowed subjects instead.", subjectError.message);
        subjects = Array.isArray(allowedSubjects) ? allowedSubjects.map((name) => ({ id: name, name })) : [];
      } else {
        throw new Error(subjectError.message || "Could not load faculty subjects.");
      }
    } else {
      subjects = data || [];
    }
  } catch (err) {
    if (isMissingTableError(err, "subjects")) {
      console.warn("Supabase subjects table is unavailable; using allowed subjects instead.", err.message);
      subjects = Array.isArray(allowedSubjects) ? allowedSubjects.map((name) => ({ id: name, name })) : [];
    } else {
      throw err;
    }
  }

  const subjectNames = (subjects || []).map((item) => item.name);
  const assignmentQuery = supabaseAdmin
    .from("assignments")
    .select("id, title, description, subject, department, semester, file_url, file_name, deadline, max_marks, status, created_at")
    .eq("faculty_id", facultyProfileId);

  if (subjectNames.length > 0) {
    assignmentQuery.in("subject", subjectNames);
  }

  const { data: assignments, error: assignmentError } = await assignmentQuery.order("created_at", { ascending: false });
  if (assignmentError) {
    throw new Error(assignmentError.message || "Could not load faculty assignments.");
  }

  const assignmentIds = (assignments || []).map((item) => item.id);
  const { data: submissions, error: submissionError } = assignmentIds.length === 0
    ? { data: [], error: null }
    : await supabaseAdmin
      .from("assignment_submissions")
      .select("id, assignment_id, student_id, student_reg_no, student_name, file_url, file_name, file_type, submitted_at, status, marks, remarks, student_notes, marks_updated_at")
      .in("assignment_id", assignmentIds)
      .order("submitted_at", { ascending: false });

  if (submissionError) {
    throw new Error(submissionError.message || "Could not load assignment submissions.");
  }

  const studentIds = [...new Set((submissions || []).map((item) => item.student_id).filter(Boolean))];
  let profiles = [];

  if (studentIds.length > 0) {
    const { data, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", studentIds);

    if (profileError) {
      const errMessage = String(profileError.message || "").toLowerCase();
      if (
        errMessage.includes("public.profiles") ||
        errMessage.includes("relation \"profiles\" does not exist") ||
        errMessage.includes("could not find the table") ||
        errMessage.includes("table 'profiles'")
      ) {
        console.warn("Supabase profiles table is unavailable; using submission student names instead.", profileError.message);
        profiles = [];
      } else {
        throw new Error(profileError.message || "Could not load student names.");
      }
    } else {
      profiles = data || [];
    }
  }

  const profileMap = new Map((profiles || []).map((item) => [item.id, item]));
  const enrichedAssignments = await Promise.all((assignments || []).map(async (assignment) => ({
    ...assignment,
    download_url: assignment.file_url ? await createSignedUrl(ASSIGNMENT_BUCKET, assignment.file_url) : null,
  })));

  const enrichedSubmissions = await Promise.all((submissions || []).map(async (submission) => ({
    ...submission,
    student_name: profileMap.get(submission.student_id)?.name || submission.student_name || "Student",
    download_url: submission.file_url ? await createSignedUrl(SUBMISSION_BUCKET, submission.file_url) : null,
  })));

  return {
    subjects: subjects || [],
    assignments: enrichedAssignments,
    submissions: enrichedSubmissions,
  };
}

module.exports = {
  ASSIGNMENT_BUCKET,
  SUBMISSION_BUCKET,
  createAssignment,
  ensureProfile,
  gradeSubmission,
  listFacultyDashboard,
  listStudentDashboard,
  submitAssignment,
};
