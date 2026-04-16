const { useEffect, useState } = React;

const API_BASE = window.SVUCommon.getApiBase();
const FACULTY_SESSION_KEY = "svuFacultySession";
let supabaseClient = null;

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

function toNumberOrNull(value) {
  if (value === "" || value === null || typeof value === "undefined") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function dateTimeForInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const url = window.SVU_SUPABASE_URL || localStorage.getItem("svuSupabaseUrl") || "";
  const key = window.SVU_SUPABASE_ANON_KEY || localStorage.getItem("svuSupabaseAnonKey") || "";
  if (!window.supabase?.createClient || !url || !key) {
    throw new Error("Supabase browser config is missing.");
  }
  supabaseClient = window.supabase.createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

async function loadFacultyProfile(client, session) {
  const { data, error } = await client
    .from("profiles")
    .select("id, name, department, semester, year, role")
    .eq("role", "faculty")
    .eq("name", session?.name || "")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message || "Could not load faculty profile.");
  }

  return data || {
    id: session?.name || "faculty",
    name: session?.name || "Faculty Member",
    department: "",
    semester: "",
    year: "",
    role: "faculty",
  };
}

async function loadSubjects(client, profile, session) {
  if (profile?.id && profile.id !== profile.name) {
    const { data, error } = await client
      .from("subjects")
      .select("id, name, department, semester, year, faculty_id")
      .eq("faculty_id", profile.id)
      .order("name");
    if (error) throw new Error(error.message || "Could not load subjects.");
    if (data?.length) return data;
  }

  const names = Array.isArray(session?.subjects) ? session.subjects.filter(Boolean) : [];
  if (!names.length) return [];
  const { data, error } = await client
    .from("subjects")
    .select("id, name, department, semester, year, faculty_id")
    .in("name", names)
    .order("name");
  if (error) throw new Error(error.message || "Could not load fallback subjects.");
  return data || [];
}

async function loadAssessments(client, subjectId) {
  if (!subjectId) return [];
  const { data, error } = await client
    .from("assessments")
    .select("id, subject_id, title, type, max_marks, date")
    .eq("subject_id", subjectId)
    .order("date", { ascending: true });
  if (error) throw new Error(error.message || "Could not load assessments.");
  return data || [];
}

async function loadStudents(client, subject) {
  if (!subject?.department) return [];
  const { data, error } = await client
    .from("profiles")
    .select("id, name, department, semester, year, role")
    .eq("role", "student")
    .eq("department", subject.department)
    .eq("semester", subject.semester)
    .eq("year", subject.year)
    .order("name");
  if (error) throw new Error(error.message || "Could not load students.");
  return data || [];
}

async function loadMarks(client, assessmentId) {
  if (!assessmentId) return [];
  const { data, error } = await client
    .from("assessment_marks")
    .select("id, student_id, assessment_id, marks_obtained, remarks")
    .eq("assessment_id", assessmentId);
  if (error) throw new Error(error.message || "Could not load marks.");
  return data || [];
}

function Toasts({ items, onDismiss }) {
  return (
    <div className="fixed right-5 top-5 z-50 flex w-full max-w-sm flex-col gap-3">
      {items.map((item) => (
        <div key={item.id} className="lms-glass rounded-2xl px-4 py-3 text-sm shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-white">{item.title}</div>
              <div className="mt-1 text-slate-300">{item.message}</div>
            </div>
            <button className="text-slate-400 hover:text-white" onClick={() => onDismiss(item.id)}>x</button>
          </div>
        </div>
      ))}
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

function LoadingCard({ label }) {
  return (
    <div className="lms-glass rounded-[24px] p-8 text-center text-slate-300">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
      <div className="mt-4 text-sm">{label}</div>
    </div>
  );
}

function EmptyCard({ title, message }) {
  return (
    <div className="lms-glass rounded-[24px] p-8 text-center">
      <div className="text-lg font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
    </div>
  );
}

function FacultySignIn({ onSignedIn, pushToast }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/faculty/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Faculty sign in failed.");
      const session = {
        email: payload.faculty?.email || form.email,
        name: payload.faculty?.name || "Faculty Member",
        role: payload.faculty?.role || "faculty",
        subjects: payload.faculty?.subjects || [],
      };
      writeSession(FACULTY_SESSION_KEY, session);
      onSignedIn(session);
      pushToast("Signed In", "Assessment panel is ready.");
    } catch (error) {
      pushToast("Sign In Failed", error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-6 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-6">
      <section className="space-y-5">
        <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-cyan-300">
          Faculty Assessment Panel
        </div>
        <h2 className="max-w-2xl text-5xl font-semibold tracking-tight text-white">
          Track class tests, quizzes, and internals from one assessment workspace.
        </h2>
        <p className="max-w-2xl text-base leading-7 text-slate-400">
          Sign in with your faculty account to create assessments and record marks and remarks for your subject groups.
        </p>
      </section>
      <form onSubmit={submit} className="lms-glass rounded-[32px] p-6">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-300">Secure Access</div>
          <h3 className="mt-2 text-2xl font-semibold text-white">Faculty Sign In</h3>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-300">Email</span>
            <input className="lms-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-300">Password</span>
            <input className="lms-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
          <button className="lms-gradient-btn w-full rounded-2xl px-5 py-4 font-semibold text-slate-950" disabled={loading}>
            {loading ? "Signing In..." : "Enter Assessment Panel"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FacultyAssessmentPanel({ session, pushToast }) {
  const [loading, setLoading] = useState(true);
  const [savingCreate, setSavingCreate] = useState(false);
  const [savingRowId, setSavingRowId] = useState("");
  const [facultyProfile, setFacultyProfile] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [assessments, setAssessments] = useState([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState("");
  const [students, setStudents] = useState([]);
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [createForm, setCreateForm] = useState({ subjectId: "", title: "", type: "quiz", maxMarks: "", date: "" });

  async function loadBundle(subjectId, subjectList = subjects, keepAssessment = selectedAssessmentId) {
    if (!subjectId) {
      setAssessments([]);
      setStudents([]);
      setSelectedAssessmentId("");
      setRows([]);
      setDrafts({});
      return;
    }

    setLoading(true);
    try {
      const client = getSupabaseClient();
      const subject = subjectList.find((item) => item.id === subjectId) || null;
      const [nextAssessments, nextStudents] = await Promise.all([
        loadAssessments(client, subjectId),
        loadStudents(client, subject),
      ]);
      setAssessments(nextAssessments);
      setStudents(nextStudents);
      setSelectedAssessmentId(nextAssessments.some((item) => item.id === keepAssessment) ? keepAssessment : (nextAssessments[0]?.id || ""));
      setCreateForm((current) => ({ ...current, subjectId: current.subjectId || subjectId }));
    } catch (error) {
      pushToast("Load Failed", error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAssessmentRows(assessmentId, studentList = students) {
    if (!assessmentId) {
      setRows([]);
      setDrafts({});
      return;
    }

    try {
      const client = getSupabaseClient();
      const marks = await loadMarks(client, assessmentId);
      const markMap = new Map(marks.map((item) => [item.student_id, item]));
      const nextRows = studentList.map((student) => ({
        student,
        record: markMap.get(student.id) || null,
      }));
      setRows(nextRows);
      setDrafts(nextRows.reduce((acc, row) => {
        acc[row.student.id] = {
          marks: row.record?.marks_obtained ?? "",
          remarks: row.record?.remarks ?? "",
        };
        return acc;
      }, {}));
    } catch (error) {
      pushToast("Marks Load Failed", error.message);
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const client = getSupabaseClient();
        const profile = await loadFacultyProfile(client, session);
        const subjectList = await loadSubjects(client, profile, session);
        setFacultyProfile(profile);
        setSubjects(subjectList);
        const firstSubjectId = subjectList[0]?.id || "";
        setSelectedSubjectId(firstSubjectId);
        setCreateForm((current) => ({ ...current, subjectId: current.subjectId || firstSubjectId }));
        if (firstSubjectId) {
          await loadBundle(firstSubjectId, subjectList, selectedAssessmentId);
        } else {
          setLoading(false);
        }
      } catch (error) {
        pushToast("Panel Error", error.message);
        setLoading(false);
      }
    }
    init();
  }, [session]);

  useEffect(() => {
    if (selectedAssessmentId) loadAssessmentRows(selectedAssessmentId, students);
    else {
      setRows([]);
      setDrafts({});
    }
  }, [selectedAssessmentId, students]);

  async function onSubjectChange(nextSubjectId) {
    setSelectedSubjectId(nextSubjectId);
    await loadBundle(nextSubjectId, subjects, "");
  }

  async function createAssessment(event) {
    event.preventDefault();
    const subjectId = createForm.subjectId || selectedSubjectId;
    if (!subjectId) return pushToast("Subject Required", "Choose a subject before creating an assessment.");
    if (!createForm.title.trim() || !createForm.date) return pushToast("Incomplete Form", "Fill title and date.");

    setSavingCreate(true);
    try {
      const client = getSupabaseClient();
      const { data, error } = await client.from("assessments").insert({
        subject_id: subjectId,
        title: createForm.title.trim(),
        type: createForm.type,
        max_marks: toNumberOrNull(createForm.maxMarks) ?? 0,
        date: new Date(createForm.date).toISOString(),
      }).select("id").single();
      if (error) throw new Error(error.message || "Could not create assessment.");
      pushToast("Assessment Created", "The assessment is now available.");
      setCreateForm((current) => ({ ...current, title: "", maxMarks: "", date: "" }));
      await loadBundle(subjectId, subjects, data?.id || "");
    } catch (error) {
      pushToast("Create Failed", error.message);
    } finally {
      setSavingCreate(false);
    }
  }

  async function saveRow(row) {
    if (!selectedAssessmentId) return pushToast("Assessment Required", "Select an assessment first.");
    setSavingRowId(row.student.id);
    try {
      const client = getSupabaseClient();
      const { data: existing, error: readError } = await client
        .from("assessment_marks")
        .select("id")
        .eq("student_id", row.student.id)
        .eq("assessment_id", selectedAssessmentId)
        .maybeSingle();
      if (readError && readError.code !== "PGRST116") throw new Error(readError.message || "Could not read existing marks.");

      const payload = {
        student_id: row.student.id,
        assessment_id: selectedAssessmentId,
        marks_obtained: drafts[row.student.id]?.marks === "" ? null : toNumberOrNull(drafts[row.student.id]?.marks),
        remarks: String(drafts[row.student.id]?.remarks || "").trim(),
      };

      if (existing?.id) {
        const { error } = await client.from("assessment_marks").update(payload).eq("id", existing.id);
        if (error) throw new Error(error.message || "Could not update marks.");
      } else {
        const { error } = await client.from("assessment_marks").insert(payload);
        if (error) throw new Error(error.message || "Could not save marks.");
      }

      pushToast("Saved", `${row.student.name} has been updated.`);
      await loadAssessmentRows(selectedAssessmentId, students);
    } catch (error) {
      pushToast("Save Failed", error.message);
    } finally {
      setSavingRowId("");
    }
  }

  const activeAssessment = assessments.find((item) => item.id === selectedAssessmentId) || null;

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-6">
      <aside className="lms-glass h-full rounded-[28px] p-5">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.35em] text-cyan-300">SVU LMS</div>
          <h1 className="mt-3 text-2xl font-semibold text-white">Assessment Panel</h1>
          <p className="mt-2 text-sm text-slate-400">Faculty workspace for quizzes, tests, and internals.</p>
        </div>
        <nav className="space-y-3">
          <a className="lms-sidebar-link active block rounded-2xl border border-slate-700/60 px-4 py-3 text-sm font-medium text-slate-200" href="#">Dashboard</a>
          <a className="lms-sidebar-link block rounded-2xl border border-slate-800/80 px-4 py-3 text-sm font-medium text-slate-400" href="/SVU-assessment-section.html">Back to Assessment Section</a>
        </nav>
        <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-slate-200">
          Manage subject assessments, marks, and remarks from one workspace.
        </div>
      </aside>

      <main className="space-y-6">
        <section className="lms-glass rounded-[28px] p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">Faculty Assessment</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">{facultyProfile?.name || session?.name || "Faculty Member"}</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Create assessments for your subjects and record marks with remarks in a clean evaluation table.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Subjects" value={String(subjects.length)} />
              <MetricCard label="Assessments" value={String(assessments.length)} />
              <MetricCard label="Students" value={String(students.length)} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className="lms-glass rounded-[28px] p-6">
              <div className="mb-4">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Subjects</div>
                <h3 className="mt-2 text-xl font-semibold text-white">Subject Selector</h3>
              </div>
              <select className="lms-select" value={selectedSubjectId} onChange={(e) => onSubjectChange(e.target.value)}>
                <option value="">Choose a subject</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </div>

            <form className="lms-glass rounded-[28px] p-6" onSubmit={createAssessment}>
              <div className="mb-4">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Publish</div>
                <h3 className="mt-2 text-xl font-semibold text-white">Create Assessment</h3>
              </div>
              <div className="space-y-4">
                <select className="lms-select" value={createForm.subjectId} onChange={(e) => setCreateForm({ ...createForm, subjectId: e.target.value })} required>
                  <option value="">Choose subject</option>
                  {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                </select>
                <input className="lms-input" placeholder="Assessment title" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} required />
                <select className="lms-select" value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
                  <option value="quiz">Quiz</option>
                  <option value="test">Test</option>
                  <option value="internal">Internal</option>
                </select>
                <input className="lms-input" type="number" min="1" placeholder="Max marks" value={createForm.maxMarks} onChange={(e) => setCreateForm({ ...createForm, maxMarks: e.target.value })} required />
                <input className="lms-input" type="datetime-local" value={createForm.date} onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })} required />
                <button className="lms-gradient-btn w-full rounded-2xl px-5 py-4 font-semibold text-slate-950" disabled={savingCreate}>
                  {savingCreate ? "Saving..." : "Create Assessment"}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-6">
            {loading ? <LoadingCard label="Loading assessment data..." /> : null}
            {!loading && !selectedSubjectId ? <EmptyCard title="Select a subject" message="Choose one of your assigned subjects to view assessments and marks." /> : null}
            {!loading && selectedSubjectId && assessments.length === 0 ? <EmptyCard title="No assessments yet" message="Publish the first assessment for this subject to begin evaluation." /> : null}

            {!loading && assessments.length > 0 ? (
              <div className="lms-glass rounded-[28px] p-6">
                <div className="mb-4">
                  <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Assessment Selector</div>
                  <h3 className="mt-2 text-xl font-semibold text-white">Assessments for the selected subject</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {assessments.map((assessment) => (
                    <button
                      key={assessment.id}
                      type="button"
                      onClick={() => setSelectedAssessmentId(assessment.id)}
                      className={classNames("assessment-mini-card p-4 text-left transition", selectedAssessmentId === assessment.id ? "active" : "")}
                    >
                      <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">{assessment.type}</div>
                      <div className="mt-2 text-lg font-semibold text-white">{assessment.title}</div>
                      <div className="mt-2 text-sm text-slate-400">Max marks: {assessment.max_marks}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{formatDateTime(assessment.date)}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!loading && activeAssessment ? (
              <div className="lms-glass rounded-[28px] p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Student Marks Table</div>
                    <h3 className="mt-2 text-xl font-semibold text-white">{activeAssessment.title}</h3>
                  </div>
                  <span className="assessment-badge pending rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
                    {activeAssessment.type} | Max {activeAssessment.max_marks}
                  </span>
                </div>

                {rows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700/70 p-8 text-center text-sm text-slate-400">
                    No students were found for this subject.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="lms-table min-w-[1020px]">
                      <thead>
                        <tr>
                          <th>Student Name</th>
                          <th>Assessment Title</th>
                          <th>Marks Input</th>
                          <th>Remarks Input</th>
                          <th>Status</th>
                          <th>Save Button</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const draft = drafts[row.student.id] || {};
                          const evaluated = Boolean(row.record?.id);
                          return (
                            <tr key={`${row.student.id}-${activeAssessment.id}`} className="assessment-table-row">
                              <td className="font-medium text-white">{row.student.name}</td>
                              <td className="text-slate-300">{activeAssessment.title}</td>
                              <td>
                                <input className="lms-input min-w-[110px]" type="number" min="0" max={activeAssessment.max_marks}
                                  value={draft.marks ?? row.record?.marks_obtained ?? ""}
                                  onChange={(e) => setDrafts((current) => ({ ...current, [row.student.id]: { ...(current[row.student.id] || {}), marks: e.target.value } }))}
                                />
                              </td>
                              <td>
                                <textarea className="lms-textarea min-w-[240px]" value={draft.remarks ?? row.record?.remarks ?? ""}
                                  onChange={(e) => setDrafts((current) => ({ ...current, [row.student.id]: { ...(current[row.student.id] || {}), remarks: e.target.value } }))}
                                />
                              </td>
                              <td>
                                <span className={classNames("assessment-badge rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]", evaluated ? "evaluated" : "pending")}>
                                  {evaluated ? "Evaluated" : "Pending"}
                                </span>
                              </td>
                              <td>
                                <button type="button" className="lms-gradient-btn rounded-2xl px-4 py-3 font-semibold text-slate-950" disabled={savingRowId === row.student.id} onClick={() => saveRow(row)}>
                                  {savingRowId === row.student.id ? "Saving..." : "Save"}
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
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() => readSession(FACULTY_SESSION_KEY));
  const [toasts, setToasts] = useState([]);

  function pushToast(title, message) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, title, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4000);
  }

  return (
    <>
      <Toasts items={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
      {session?.email || session?.name ? (
        <FacultyAssessmentPanel session={session} pushToast={pushToast} />
      ) : (
        <FacultySignIn onSignedIn={setSession} pushToast={pushToast} />
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("assessmentApp")).render(<App />);
