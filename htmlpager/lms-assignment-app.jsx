const { useEffect, useMemo, useState } = React;

const API_BASE = window.SVUCommon.getApiBase();
const STUDENT_AUTH_KEY = "svuAuthSession";
const FACULTY_AUTH_KEY = "svuFacultySession";

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function statusLabel(value) {
  if (value === "submitted") return "Submitted";
  if (value === "late") return "Late";
  return "Not Submitted";
}

function statusTone(value) {
  if (value === "submitted") return "submitted";
  if (value === "late") return "late";
  return "pending";
}

function readSession(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch (_) {
    return null;
  }
}

function writeSession(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

async function fetchAssignmentsWithSubmissions(studentProfile, selectedSubjectId) {
  if (!selectedSubjectId) {
    return [];
  }

  const isUuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(selectedSubjectId));
  if (!isUuidLike) {
    return [];
  }

  const data = await readJson(`${API_BASE}/lms/assignment/student/dashboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      regNumber: studentProfile.regNumber,
      email: studentProfile.email,
      course: studentProfile.department,
      semester: studentProfile.semester,
      subjectId: selectedSubjectId,
    }),
  });

  return data.assignments || [];
}

function Toasts({ toasts, onDismiss }) {
  return (
    <div className="fixed right-5 top-5 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <div key={toast.id} className="lms-glass rounded-2xl px-4 py-3 text-sm shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-white">{toast.title}</div>
              <div className="mt-1 text-slate-300">{toast.message}</div>
            </div>
            <button className="text-slate-400 hover:text-white" onClick={() => onDismiss(toast.id)}>x</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Sidebar({ role }) {
  return (
    <aside className="lms-glass h-full rounded-[28px] p-5">
      <div className="mb-8">
        <div className="text-xs uppercase tracking-[0.35em] text-cyan-300">SVU LMS</div>
        <h1 className="mt-3 text-2xl font-semibold text-white">Assignments</h1>
        <p className="mt-2 text-sm text-slate-400">
          {role === "faculty" ? "Evaluation workspace" : "Submission workspace"}
        </p>
      </div>
      <nav className="space-y-3">
        <a className="lms-sidebar-link active block rounded-2xl border border-slate-700/60 px-4 py-3 text-sm font-medium text-slate-200" href="#">
          Dashboard
        </a>
        <a className="lms-sidebar-link block rounded-2xl border border-slate-800/80 px-4 py-3 text-sm font-medium text-slate-400" href="#">
          Assignments
        </a>
      </nav>
      <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-slate-200">
        Scalable module foundation for Exams, Assessments, and Internals.
      </div>
    </aside>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="lms-glass rounded-[24px] p-8 text-center">
      <div className="text-lg font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
    </div>
  );
}

function LoadingPanel({ label = "Loading..." }) {
  return (
    <div className="lms-glass rounded-[24px] p-8 text-center text-slate-300">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
      <div className="mt-4 text-sm">{label}</div>
    </div>
  );
}

function StudentApp({ pushToast }) {
  const auth = readSession(STUDENT_AUTH_KEY);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");
  const [dashboard, setDashboard] = useState({ profile: null, subjects: [], assignments: [] });
  const [subjectId, setSubjectId] = useState("");
  const [drafts, setDrafts] = useState({});

  async function loadDashboard(activeSubjectId = "") {
    if (!auth?.regNumber || !auth?.email) {
      window.location.replace("/SVUsignin.html");
      return;
    }

    setLoading(true);
    try {
      const subjectPayload = await readJson(`${API_BASE}/lms/student-subjects?regNumber=${encodeURIComponent(auth.regNumber)}`);
      const studentProfile = {
        id: subjectPayload.student?.regNumber || auth.regNumber,
        name: subjectPayload.student?.name || auth.studentName || "Student",
        department: subjectPayload.student?.department || auth.course || "",
        semester: subjectPayload.student?.semester || auth.semester || "",
        year: subjectPayload.student?.year || auth.year || "",
        regNumber: subjectPayload.student?.regNumber || auth.regNumber,
        email: auth.email,
      };
      const subjects = Array.isArray(subjectPayload.subjects) ? subjectPayload.subjects : [];
      const nextSubjectId = activeSubjectId || subjects[0]?.id || "";

      setDashboard({
        profile: studentProfile,
        subjects,
        assignments: [],
      });

      if (!activeSubjectId && nextSubjectId && nextSubjectId !== subjectId) {
        setSubjectId(nextSubjectId);
      }

      const assignments = await fetchAssignmentsWithSubmissions(studentProfile, nextSubjectId);
      setDashboard({
        profile: studentProfile,
        subjects,
        assignments,
      });
    } catch (error) {
      pushToast("Dashboard Error", error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard(subjectId);
  }, [subjectId]);

  function updateDraft(assignmentId, patch) {
    setDrafts((current) => ({
      ...current,
      [assignmentId]: {
        ...(current[assignmentId] || {}),
        ...patch,
      },
    }));
  }

  async function handleSubmit(assignment) {
    const draft = drafts[assignment.id] || {};
    if (!draft.file) {
      pushToast("File Required", "Choose a file before submitting.");
      return;
    }

    setSubmittingId(assignment.id);
    try {
      const fileBase64 = await fileToBase64(draft.file);
      await readJson(`${API_BASE}/lms/assignment/student/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regNumber: auth.regNumber,
          email: auth.email,
          assignmentId: assignment.id,
          fileName: draft.file.name,
          fileType: draft.file.type,
          fileData: fileBase64,
          notes: draft.notes || "",
        }),
      });
      pushToast("Submission Saved", `${assignment.title} is now in the faculty queue.`);
      await loadDashboard(subjectId);
    } catch (error) {
      pushToast("Submission Failed", error.message);
    } finally {
      setSubmittingId("");
    }
  }

  const assignmentCards = useMemo(() => dashboard.assignments || [], [dashboard.assignments]);

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-6">
      <Sidebar role="student" />
      <main className="space-y-6">
        <section className="lms-glass rounded-[28px] p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">Student Dashboard</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">
                {dashboard.profile?.name || auth?.studentName || "Student"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Upload assignment files, add notes, track due dates, and review marks after faculty evaluation.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Assignments" value={String(assignmentCards.length)} />
              <MetricCard label="Submitted" value={String(assignmentCards.filter((item) => item.submission).length)} />
              <MetricCard label="Late" value={String(assignmentCards.filter((item) => item.submission?.status === "late").length)} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="lms-glass rounded-[28px] p-6">
            <div className="mb-4">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Subjects</div>
              <h3 className="mt-2 text-xl font-semibold text-white">Subject Selector</h3>
            </div>
            <select className="lms-select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">All Active Subjects</option>
              {(dashboard.subjects || []).map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
              Subjects are now resolved from the student&apos;s Supabase academic record on the server.
            </div>
          </div>

          <div className="space-y-5">
            {loading ? <LoadingPanel label="Loading assignment feed..." /> : null}
            {!loading && assignmentCards.length === 0 ? (
              <EmptyState
                title="No assignments yet"
                message="Your faculty has not published assignments for the selected subject yet."
              />
            ) : null}
            {!loading && assignmentCards.map((assignment) => {
              const submission = assignment.submission;
              const draft = drafts[assignment.id] || {};
              return (
                <article key={assignment.id} className="lms-glass rounded-[28px] p-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.28em] text-cyan-300">
                        {(dashboard.subjects || []).find((subject) => subject.id === assignment.subject_id)?.name || "Subject"}
                      </div>
                      <h3 className="mt-2 text-2xl font-semibold text-white">{assignment.title}</h3>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{assignment.description || "No description provided."}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={classNames("lms-status-pill rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]", statusTone(submission?.derivedStatus || "pending"))}>
                        {statusLabel(submission?.derivedStatus || "pending")}
                      </span>
                      <div className="rounded-full border border-slate-700/70 bg-slate-950/40 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-300">
                        Due {new Date(assignment.due_date).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {!submission?.id ? (
                    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-300">Upload Assignment File</span>
                        <input
                          className="lms-input"
                          type="file"
                          onChange={(event) => updateDraft(assignment.id, { file: event.target.files?.[0] || null })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-300">Add Notes</span>
                        <textarea
                          className="lms-textarea min-h-[110px]"
                          placeholder="Add short notes for faculty review"
                          value={draft.notes || ""}
                          onChange={(event) => updateDraft(assignment.id, { notes: event.target.value })}
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          className="lms-gradient-btn w-full rounded-2xl px-5 py-4 text-sm font-semibold text-slate-950"
                          disabled={submittingId === assignment.id}
                          onClick={() => handleSubmit(assignment)}
                        >
                          {submittingId === assignment.id ? "Submitting..." : "Submit"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 grid gap-4 md:grid-cols-4">
                      <ReadoutCard label="Submitted At" value={new Date(submission.submitted_at).toLocaleString()} />
                      <ReadoutCard label="Marks" value={submission.marks ?? "Pending"} />
                      <ReadoutCard label="Remarks" value={submission.remarks || "Faculty review pending"} />
                      <ReadoutCard label="Notes" value={submission.student_notes || "No notes added"} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function FacultySignin({ onSignedIn, pushToast }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await readJson(`${API_BASE}/faculty/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const session = {
        email: data.faculty.email,
        name: data.faculty.name,
        role: data.faculty.role,
        subjects: data.faculty.subjects || [],
      };
      writeSession(FACULTY_AUTH_KEY, session);
      onSignedIn(session);
      pushToast("Faculty Signed In", "Evaluation panel is ready.");
    } catch (error) {
      pushToast("Sign In Failed", error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-6 px-4 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-6">
      <section className="space-y-5">
        <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-cyan-300">
          Faculty Assignment Panel
        </div>
        <h2 className="max-w-2xl text-5xl font-semibold tracking-tight text-white">Grade, review, and organize assignment workflows in one place.</h2>
        <p className="max-w-2xl text-base leading-7 text-slate-400">
          This module adds a scalable LMS block for assignments and keeps room for future evaluation systems like assessments, exams, and internals.
        </p>
      </section>
      <form onSubmit={handleSubmit} className="lms-glass rounded-[32px] p-6">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-300">Secure Access</div>
          <h3 className="mt-2 text-2xl font-semibold text-white">Faculty Sign In</h3>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-300">Email</span>
            <input className="lms-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-300">Password</span>
            <input className="lms-input" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          </label>
          <button className="lms-gradient-btn w-full rounded-2xl px-5 py-4 font-semibold text-slate-950" disabled={loading}>
            {loading ? "Signing In..." : "Enter Faculty Panel"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FacultySelectionPanel({ session, onComplete, pushToast }) {
  const [departments, setDepartments] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState(session?.department || "");
  const [selectedSemester, setSelectedSemester] = useState(session?.semester || "");
  const [selectedSubjects, setSelectedSubjects] = useState(Array.isArray(session?.subjects) ? session.subjects : []);
  const [loading, setLoading] = useState(true);
  const [loadingSemesters, setLoadingSemesters] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  useEffect(() => {
    async function loadDepartments() {
      setLoading(true);
      try {
        const data = await readJson(`${API_BASE}/courses?unique=true`);
        setDepartments(Array.isArray(data.courses) ? data.courses : []);
      } catch (error) {
        pushToast("Load Failed", error.message);
      } finally {
        setLoading(false);
      }
    }
    loadDepartments();
  }, []);

  useEffect(() => {
    if (!selectedDepartment) {
      setSemesters([]);
      setSelectedSemester("");
      setSubjects([]);
      setSelectedSubjects([]);
      return;
    }

    async function loadSemesters() {
      setLoadingSemesters(true);
      try {
        const data = await readJson(`${API_BASE}/courses?course=${encodeURIComponent(selectedDepartment)}&semesters=true`);
        setSemesters(Array.isArray(data.semesters) ? data.semesters : []);
      } catch (error) {
        pushToast("Load Failed", error.message);
      } finally {
        setLoadingSemesters(false);
      }
    }
    loadSemesters();
  }, [selectedDepartment]);

  useEffect(() => {
    if (!selectedDepartment || !selectedSemester) {
      setSubjects([]);
      setSelectedSubjects([]);
      return;
    }

    async function loadSubjects() {
      setLoadingSubjects(true);
      try {
        const data = await readJson(`${API_BASE}/courses?course=${encodeURIComponent(selectedDepartment)}&semester=${encodeURIComponent(selectedSemester)}`);
        const available = Array.isArray(data.subjects) ? data.subjects : [];
        setSubjects(available.map((item) => ({
          name: String(item.subject || item.name || "").trim(),
          year: String(item.year || "").trim(),
        })).filter((item) => item.name));
      } catch (error) {
        pushToast("Load Failed", error.message);
      } finally {
        setLoadingSubjects(false);
      }
    }
    loadSubjects();
  }, [selectedDepartment, selectedSemester]);

  function toggleSubject(subjectName) {
    setSelectedSubjects((current) =>
      current.includes(subjectName)
        ? current.filter((item) => item !== subjectName)
        : [...current, subjectName]
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!selectedDepartment || !selectedSemester || selectedSubjects.length === 0) {
      pushToast("Selection Required", "Please choose department, semester, and at least one subject.");
      return;
    }

    const updatedSession = {
      ...session,
      department: selectedDepartment,
      semester: selectedSemester,
      subjects: selectedSubjects,
    };
    writeSession(FACULTY_AUTH_KEY, updatedSession);
    onComplete(updatedSession);
  }

  const availableSubjects = subjects.filter((item, index, self) => self.findIndex((other) => other.name === item.name) === index);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center px-4 py-8">
        <LoadingPanel label="Loading course selection..." />
      </div>
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-6">
      <Sidebar role="faculty" />
      <main className="space-y-6">
        <section className="lms-glass rounded-[28px] p-6">
          <div className="mb-4">
            <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Faculty Setup</div>
            <h3 className="mt-2 text-xl font-semibold text-white">Choose department, semester, and subjects</h3>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300">Department</label>
              <select className="lms-select mt-3 w-full" value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)} required>
                <option value="">Choose department</option>
                {departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Semester</label>
              <select className="lms-select mt-3 w-full" value={selectedSemester} onChange={(event) => setSelectedSemester(event.target.value)} disabled={!selectedDepartment || loadingSemesters} required>
                <option value="">Choose semester</option>
                {semesters.map((semester) => (
                  <option key={semester} value={semester}>{semester}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-300">Subjects</label>
                <span className="text-xs text-slate-500">{selectedSubjects.length} selected</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {availableSubjects.length === 0 ? (
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-6 text-sm text-slate-400">
                    {loadingSubjects ? "Loading subjects..." : "Choose department and semester to load subjects."}
                  </div>
                ) : availableSubjects.map((subject) => (
                  <button
                    key={subject.name}
                    type="button"
                    onClick={() => toggleSubject(subject.name)}
                    className={classNames(
                      "rounded-2xl border p-4 text-left transition",
                      selectedSubjects.includes(subject.name)
                        ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                        : "border-slate-700/70 bg-slate-950/30 text-slate-300 hover:border-slate-600"
                    )}
                  >
                    <div className="text-sm font-medium">{subject.name}</div>
                    {subject.year ? <div className="text-xs text-slate-500 mt-1">Year {subject.year}</div> : null}
                  </button>
                ))}
              </div>
            </div>

            <button className="lms-gradient-btn w-full rounded-2xl px-5 py-4 font-semibold text-slate-950" type="submit">
              Save Selection and Continue
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function FacultyApp({ pushToast }) {
  const [session, setSession] = useState(() => readSession(FACULTY_AUTH_KEY));
  const [loading, setLoading] = useState(true);
  const [subjectId, setSubjectId] = useState("");
  const [dashboard, setDashboard] = useState({ faculty: null, subjects: [], assignments: [], submissions: [] });
  const [createForm, setCreateForm] = useState({ subjectName: "", title: "", description: "", dueDate: "" });
  const [savingCreate, setSavingCreate] = useState(false);
  const [savingGradeId, setSavingGradeId] = useState("");
  const [draftGrades, setDraftGrades] = useState({});

  const availableSubjects = (dashboard.subjects && dashboard.subjects.length)
    ? dashboard.subjects
    : (Array.isArray(session?.subjects) ? session.subjects.map((name) => ({ id: name, name })) : []);

  const hasCompleteSelection = session?.department && session?.semester && Array.isArray(session?.subjects) && session.subjects.length > 0;

  async function loadDashboard(activeSubjectId = "") {
    if (!session?.email || !hasCompleteSelection) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await readJson(`${API_BASE}/lms/assignment/faculty/dashboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          subjectId: activeSubjectId,
          allowedSubjects: session.subjects,
        }),
      });
      setDashboard(data);
      setCreateForm((current) => ({
        ...current,
        subjectName: current.subjectName || data.subjects?.[0]?.name || session.subjects?.[0] || "",
      }));
    } catch (error) {
      pushToast("Dashboard Error", error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session?.email && hasCompleteSelection) {
      loadDashboard(subjectId);
    } else {
      setLoading(false);
    }
  }, [session, subjectId, hasCompleteSelection]);

  if (!session?.email) {
    return <FacultySignin onSignedIn={setSession} pushToast={pushToast} />;
  }

  if (!hasCompleteSelection) {
    return <FacultySelectionPanel session={session} onComplete={setSession} pushToast={pushToast} />;
  }

  async function createAssignmentRecord(event) {
    event.preventDefault();
    setSavingCreate(true);
    try {
      await readJson(`${API_BASE}/lms/assignment/faculty/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          allowedSubjects: session.subjects,
          ...createForm,
        }),
      });
      pushToast("Assignment Created", "The assignment is now visible in the LMS feed.");
      setCreateForm({ ...createForm, title: "", description: "", dueDate: "" });
      await loadDashboard(subjectId);
    } catch (error) {
      pushToast("Create Failed", error.message);
    } finally {
      setSavingCreate(false);
    }
  }

  async function saveGrade(submission) {
    const draft = draftGrades[submission.id] || {};
    setSavingGradeId(submission.id);
    try {
      await readJson(`${API_BASE}/lms/assignment/faculty/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          submissionId: submission.id,
          marks: draft.marks ?? submission.marks ?? "",
          remarks: draft.remarks ?? submission.remarks ?? "",
        }),
      });
      pushToast("Grading Saved", `Marks updated for ${submission.student_name}.`);
      await loadDashboard(subjectId);
    } catch (error) {
      pushToast("Grade Failed", error.message);
    } finally {
      setSavingGradeId("");
    }
  }

  function resetSelection() {
    const updated = {
      ...session,
      department: "",
      semester: "",
      subjects: [],
    };
    writeSession(FACULTY_AUTH_KEY, updated);
    setSession(updated);
    setSubjectId("");
  }

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-6">
      <Sidebar role="faculty" />
      <main className="space-y-6">
        <section className="lms-glass rounded-[28px] p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">Faculty Evaluation</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">{dashboard.faculty?.name || session.name || "Faculty Member"}</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Filter by subject, publish new assignments, evaluate submissions, and save marks with remarks.
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-300">
                <span className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-2">Department: {session.department || "Not set"}</span>
                <span className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-2">Semester: {session.semester || "Not set"}</span>
                <span className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-2">Subjects: {Array.isArray(session.subjects) ? session.subjects.length : 0}</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={resetSelection} className="lms-outline-btn rounded-2xl px-5 py-3 text-sm font-semibold text-white">
                Change Selection
              </button>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Subjects" value={String((dashboard.subjects || []).length)} />
                <MetricCard label="Assignments" value={String((dashboard.assignments || []).length)} />
                <MetricCard label="Submissions" value={String((dashboard.submissions || []).length)} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className="lms-glass rounded-[28px] p-6">
              <div className="mb-4">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Filter</div>
                <h3 className="mt-2 text-xl font-semibold text-white">Subject Filter</h3>
              </div>
              <select className="lms-select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="">All Assigned Subjects</option>
                {availableSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.name}</option>
                ))}
              </select>
            </div>

            <form className="lms-glass rounded-[28px] p-6" onSubmit={createAssignmentRecord}>
              <div className="mb-4">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Publish</div>
                <h3 className="mt-2 text-xl font-semibold text-white">Create Assignment</h3>
              </div>
              <div className="space-y-4">
                <select className="lms-select" value={createForm.subjectName} onChange={(event) => setCreateForm({ ...createForm, subjectName: event.target.value })} required>
                  <option value="">Choose Subject</option>
                  {availableSubjects.map((subject) => (
                    <option key={subject.id} value={subject.name}>{subject.name}</option>
                  ))}
                </select>
                <input className="lms-input" placeholder="Assignment title" value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} required />
                <textarea className="lms-textarea min-h-[140px]" placeholder="Assignment description" value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} />
                <input className="lms-input" type="datetime-local" value={createForm.dueDate} onChange={(event) => setCreateForm({ ...createForm, dueDate: event.target.value })} required />
                <button className="lms-gradient-btn w-full rounded-2xl px-5 py-4 font-semibold text-slate-950" disabled={savingCreate}>
                  {savingCreate ? "Saving..." : "Publish Assignment"}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-6">
            {loading ? <LoadingPanel label="Loading faculty data..." /> : null}
            {!loading && (dashboard.assignments || []).length === 0 ? (
              <EmptyState title="No assignments published" message="Create the first assignment to start the submission workflow." />
            ) : null}

            {!loading && (dashboard.assignments || []).length > 0 ? (
              <div className="lms-glass rounded-[28px] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Assignment-wise View</div>
                    <h3 className="mt-2 text-xl font-semibold text-white">Published Assignments</h3>
                  </div>
                </div>
                <div className="grid gap-4">
                  {(dashboard.assignments || []).map((assignment) => (
                    <div key={assignment.id} className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
                      <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">
                        {(dashboard.subjects || []).find((subject) => subject.id === assignment.subject_id)?.name || "Subject"}
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">{assignment.title}</div>
                      <div className="mt-2 text-sm text-slate-400">{assignment.description || "No description provided."}</div>
                      <div className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                        Due {new Date(assignment.due_date).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!loading && (
              <div className="lms-glass rounded-[28px] p-6">
                <div className="mb-4">
                  <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Submissions</div>
                  <h3 className="mt-2 text-xl font-semibold text-white">Student Submission Table</h3>
                </div>
                {(dashboard.submissions || []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700/70 p-8 text-center text-sm text-slate-400">
                    No submissions yet for the current filter.
                  </div>
                ) : (
                  <div className="lms-scrollbar overflow-x-auto">
                    <table className="lms-table min-w-[1080px]">
                      <thead>
                        <tr>
                          <th>Student Name</th>
                          <th>Assignment Title</th>
                          <th>File</th>
                          <th>Submission Date</th>
                          <th>Status</th>
                          <th>Marks Input</th>
                          <th>Remarks Input</th>
                          <th>Save Button</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dashboard.submissions || []).map((submission) => {
                          const draft = draftGrades[submission.id] || {};
                          const assignment = (dashboard.assignments || []).find((item) => item.id === submission.assignment_id);
                          return (
                            <tr key={submission.id}>
                              <td className="font-medium text-white">{submission.student_name}</td>
                              <td className="text-slate-300">{assignment?.title || "Assignment"}</td>
                              <td>
                                <a className="text-cyan-300 underline" href={submission.file_url} target="_blank" rel="noreferrer">View / Download</a>
                              </td>
                              <td className="text-slate-300">{new Date(submission.submitted_at).toLocaleString()}</td>
                              <td>
                                <span className={classNames("lms-status-pill rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]", statusTone(submission.status))}>
                                  {submission.status === "late" ? "Late" : "On-time"}
                                </span>
                              </td>
                              <td>
                                <input
                                  className="lms-input min-w-[110px]"
                                  type="number"
                                  value={draft.marks ?? submission.marks ?? ""}
                                  onChange={(event) => setDraftGrades((current) => ({
                                    ...current,
                                    [submission.id]: {
                                      ...(current[submission.id] || {}),
                                      marks: event.target.value,
                                    },
                                  }))}
                                />
                              </td>
                              <td>
                                <textarea
                                  className="lms-textarea min-w-[240px]"
                                  value={draft.remarks ?? submission.remarks ?? ""}
                                  onChange={(event) => setDraftGrades((current) => ({
                                    ...current,
                                    [submission.id]: {
                                      ...(current[submission.id] || {}),
                                      remarks: event.target.value,
                                    },
                                  }))}
                                />
                              </td>
                              <td>
                                <button className="lms-gradient-btn rounded-2xl px-4 py-3 font-semibold text-slate-950" disabled={savingGradeId === submission.id} onClick={() => saveGrade(submission)}>
                                  {savingGradeId === submission.id ? "Saving..." : "Save"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/30 px-4 py-4">
      <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

function ReadoutCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
      <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</div>
      <div className="mt-3 text-sm font-medium leading-6 text-white">{String(value)}</div>
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function App() {
  const rootNode = document.getElementById("assignmentApp");
  const view = rootNode?.dataset.view || "student";
  const [toasts, setToasts] = useState([]);

  function pushToast(title, message) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, title, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }

  return (
    <>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
      {view === "faculty" ? <FacultyApp pushToast={pushToast} /> : <StudentApp pushToast={pushToast} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("assignmentApp")).render(<App />);
