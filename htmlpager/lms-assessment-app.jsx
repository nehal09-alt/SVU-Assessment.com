const { useEffect, useMemo, useState } = React;

const AUTH_KEY = "svuAuthSession";
const API_BASE = window.location.origin;

function readAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null");
  } catch (_) {
    return null;
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseSemester(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function parseYear(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function deriveSemesterFromRegNumber(regNumber) {
  const match = String(regNumber || "").match(/20(\d{2})/);
  if (!match) return null;
  const admissionYear = Number(`20${match[1]}`);
  if (!Number.isFinite(admissionYear)) return null;
  const currentYear = new Date().getFullYear();
  return Math.max(1, (currentYear - admissionYear) * 2);
}

function deriveYearFromSemester(semester) {
  const sem = Number(semester || 0);
  if (!sem) return null;
  return Math.max(1, Math.ceil(sem / 2));
}

function formatDate(value) {
  if (!value) return "TBA";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function statusTone(markRecord) {
  return markRecord ? "evaluated" : "pending";
}

function statusLabel(markRecord) {
  return markRecord ? "Evaluated" : "Pending";
}

function typeTone(type) {
  const normalized = normalizeText(type);
  if (normalized.includes("quiz")) return "quiz";
  if (normalized.includes("test")) return "test";
  if (normalized.includes("internal")) return "internal";
  return "test";
}

function useAssessmentToast() {
  const [toasts, setToasts] = useState([]);

  function pushToast(title, message) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, title, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }

  return { toasts, pushToast, dismiss: (id) => setToasts((current) => current.filter((item) => item.id !== id)) };
}

function Toasts({ toasts, onDismiss }) {
  return (
    <div className="fixed right-5 top-5 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <div key={toast.id} className="assessment-glass rounded-2xl px-4 py-3 text-sm shadow-2xl">
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

function Sidebar() {
  return (
    <aside className="assessment-glass h-full rounded-[28px] p-5">
      <div className="mb-8">
        <div className="text-xs uppercase tracking-[0.35em] text-cyan-300">SVU LMS</div>
        <h1 className="mt-3 text-2xl font-semibold text-white">Assessments</h1>
        <p className="mt-2 text-sm text-slate-400">Class tests, quizzes, and internal evaluation records.</p>
      </div>
      <nav className="space-y-3">
        <a className="block rounded-2xl border border-slate-700/60 px-4 py-3 text-sm font-medium text-slate-200" href="/SVUdashboard.html">
          Dashboard
        </a>
        <a className="block rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-white" href="/SVU-assessment-dashboard.html">
          Assessments
        </a>
      </nav>
      <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-slate-200">
        Subjects and marks are pulled from Supabase with the current student session.
      </div>
    </aside>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/30 px-4 py-4">
      <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="assessment-glass rounded-[24px] p-8 text-center">
      <div className="text-lg font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
    </div>
  );
}

function LoadingPanel({ label = "Loading..." }) {
  return (
    <div className="assessment-glass rounded-[24px] p-8 text-center text-slate-300">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
      <div className="mt-4 text-sm">{label}</div>
    </div>
  );
}

async function fetchAssessmentDashboard(payload) {
  const regNumber = String(payload?.regNumber || "").trim();
  const response = await fetch(`${API_BASE}/lms/student-subjects?regNumber=${encodeURIComponent(regNumber)}`);

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || "Could not load student subjects.");
  }

  return data || {};
}

function AssessmentCard({ assessment, markRecord }) {
  return (
    <article className="assessment-card p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-300">Assessment</div>
          <h3 className="mt-2 text-2xl font-semibold text-white">{assessment.title}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-400">Review class tests, quizzes, and internal assessment records in one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`assessment-pill ${typeTone(assessment.type)}`}>{String(assessment.type || "internal")}</span>
          <span className={`assessment-pill ${statusTone(markRecord)}`}>{statusLabel(markRecord)}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <ReadoutCard label="Date" value={formatDate(assessment.date)} />
        <ReadoutCard label="Max Marks" value={assessment.max_marks || "TBA"} />
        <ReadoutCard label="Marks Obtained" value={markRecord?.marks_obtained ?? "Pending"} />
        <ReadoutCard label="Remarks" value={markRecord?.remarks || "No feedback yet"} />
      </div>
    </article>
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

function AssessmentDashboard() {
  const auth = readAuth();
  const { toasts, pushToast, dismiss } = useAssessmentToast();
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [assessments, setAssessments] = useState([]);
  const [error, setError] = useState("");

  async function loadDashboard(activeSubjectId = "") {
    if (!auth?.regNumber) {
      window.location.replace("/SVUsignin.html");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload = await fetchAssessmentDashboard({
        regNumber: auth.regNumber,
        email: auth.email || "",
        department: auth.department || auth.course || "",
        semester: auth.semester || "",
        year: auth.year || "",
        subjectId: activeSubjectId || "",
      });

      const resolvedStudent = payload.student
        ? {
            id: payload.student.regNumber,
            name: payload.student.name || auth.studentName || "Student",
            department: payload.student.department || auth.course || "",
            semester: parseSemester(payload.student.semester) || parseSemester(auth.semester) || 1,
            year: parseYear(payload.student.year) || parseYear(auth.year) || 1,
          }
        : null;
      const resolvedSubjects = Array.isArray(payload.subjects) ? payload.subjects : [];
      const resolvedAssessments = [];
      const subjectId = activeSubjectId || resolvedSubjects[0]?.id || "";

      setStudent(resolvedStudent);
      setSubjects(resolvedSubjects);
      setSelectedSubjectId(subjectId);
      setAssessments(resolvedAssessments);
    } catch (err) {
      console.error(err);
      const message = err?.message || "Could not load assessment data.";
      setError(message);
      pushToast("Assessment Error", message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard(selectedSubjectId);
  }, [selectedSubjectId]);

  const assessmentsWithMarks = useMemo(() => {
    return assessments.map((assessment) => ({
      assessment,
      markRecord: assessment.result || null,
    }));
  }, [assessments]);

  const totals = useMemo(() => {
    const evaluated = assessmentsWithMarks.filter((item) => item.markRecord).length;
    return {
      total: assessmentsWithMarks.length,
      evaluated,
      pending: assessmentsWithMarks.length - evaluated,
    };
  }, [assessmentsWithMarks]);

  useEffect(() => {
    if (!student || subjects.length === 0) return;
    const currentSubject = subjects.find((subject) => String(subject.id) === String(selectedSubjectId));
    if (!currentSubject && subjects[0]?.id) {
      setSelectedSubjectId(subjects[0].id);
    }
  }, [student, subjects, selectedSubjectId]);

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-6">
      <Sidebar />
      <main className="space-y-6">
        <section className="assessment-glass rounded-[28px] p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">Student Assessment Dashboard</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">{student?.name || auth?.studentName || "Student"}</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                See your assessment subjects, assessment cards, and marks status in a single LMS view.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Assessments" value={String(totals.total)} />
              <StatCard label="Evaluated" value={String(totals.evaluated)} />
              <StatCard label="Pending" value={String(totals.pending)} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="assessment-glass rounded-[28px] p-6">
            <div className="mb-4">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Subjects</div>
              <h3 className="mt-2 text-xl font-semibold text-white">Subject Dropdown</h3>
            </div>
            <select className="assessment-select" value={selectedSubjectId} onChange={(event) => setSelectedSubjectId(event.target.value)}>
              <option value="">All Active Subjects</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
              Subjects are filtered from Supabase using your department, semester, and year.
            </div>
            <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Student Record</div>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between gap-4"><span>Name</span><strong className="text-white">{student?.name || "Loading..."}</strong></div>
                <div className="flex justify-between gap-4"><span>Department</span><strong className="text-white">{student?.department || "Loading..."}</strong></div>
                <div className="flex justify-between gap-4"><span>Semester</span><strong className="text-white">{student?.semester || "Loading..."}</strong></div>
                <div className="flex justify-between gap-4"><span>Year</span><strong className="text-white">{student?.year || "Loading..."}</strong></div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {loading ? <LoadingPanel label="Loading assessment dashboard..." /> : null}
            {!loading && error ? (
              <div className="assessment-glass rounded-[24px] p-6 text-sm text-rose-200">
                {error}
              </div>
            ) : null}
            {!loading && !error && assessmentsWithMarks.length === 0 ? (
              <EmptyState
                title="No assessments yet"
                message="Your faculty has not published assessments for the selected subject."
              />
            ) : null}
            {!loading && assessmentsWithMarks.map(({ assessment, markRecord }) => (
              <AssessmentCard key={assessment.id} assessment={assessment} markRecord={markRecord} />
            ))}
          </div>
        </section>
      </main>
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("assessmentApp")).render(<AssessmentDashboard />);
