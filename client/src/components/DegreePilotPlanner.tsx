import { useState, type FormEvent } from "react";
import "./DegreePilotPlanner.css";

type ProposedCourse = {
  courseId: string;
  reason: string;
  prerequisiteNote: string;
};
type PlanResponse = {
  plan: {
    semesters: { year: number; season: string; courses: ProposedCourse[] }[];
    overview: string;
    limitations: string[];
  };
  finalProposedTerm: { year: number; season: string } | null;
  graduationStatus: "requirements_missing" | "needs_verification";
  revision: { attempted: boolean; accepted: boolean; note: string };
  coverage: {
    missing: { requirementId: string; explanation: string }[];
    uncertain: { requirementId: string; explanation: string }[];
    degreeCredits: {
      required: number;
      appliedIncludingIP: number;
      knownAdditional: number;
      projectedTotalIfCoursesCount: number | null;
      remainingIfKnown: number | null;
    } | null;
  };
  validation: {
    canDisplayProvisionalPlan: boolean;
    errors: { message: string }[];
    warnings: { message: string }[];
  };
  prerequisites: { courseId: string; result: string; note: string }[];
};
const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
export default function DegreePilotPlanner() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [maxCourses, setMaxCourses] = useState(3);
  const [summer, setSummer] = useState(false);
  const [winter, setWinter] = useState(false);
  const [startSeason, setStartSeason] = useState("Fall");
  const [startYear, setStartYear] = useState(2027);
  const [demoCode, setDemoCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResponse | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pdf) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = new FormData();
      data.append("degreeworks", pdf);
      data.append(
        "preferences",
        JSON.stringify({
          startTerm: { season: startSeason, year: startYear },
          maxCoursesPerSemester: maxCourses,
          includeSummer: summer,
          includeWinter: winter,
        }),
      );
      const response = await fetch(`${apiBase}/api/degreepilot/plan`, {
        method: "POST",
        body: data,
        headers: demoCode ? { "x-degreepilot-demo-key": demoCode } : {},
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
      setResult(body as PlanResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }
  const credits = result?.coverage.degreeCredits;
  return (
    <main className="dp-page">
      <header className="dp-header">
        <p className="dp-eyebrow">DEGREEPILOT AI</p>
        <h1>Your next two years, thoughtfully planned.</h1>
        <p>
          Upload a DegreeWorks PDF for a provisional, requirement-aware course
          plan.
        </p>
      </header>
      <form onSubmit={submit} className="dp-form">
        <label className="dp-field">
          DegreeWorks PDF
          <input
            type="file"
            accept=".pdf,application/pdf"
            required
            onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="dp-grid">
          <label className="dp-field">
            Maximum courses per term
            <select
              value={maxCourses}
              onChange={(e) => setMaxCourses(+e.target.value)}
            >
              {[1, 2, 3, 4].map((n) => (
                <option value={n} key={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="dp-field">
            Starting season
            <select
              value={startSeason}
              onChange={(e) => setStartSeason(e.target.value)}
            >
              {["Winter", "Spring", "Summer", "Fall"].map((s) => (
                <option value={s} key={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="dp-field">
            Starting year
            <input
              type="number"
              value={startYear}
              min={2026}
              max={2100}
              onChange={(e) => setStartYear(+e.target.value)}
            />
          </label>
          <label className="dp-field">
            Private demo code (if provided)
            <input
              type="password"
              value={demoCode}
              autoComplete="off"
              onChange={(e) => setDemoCode(e.target.value)}
              placeholder="Optional on local development"
            />
          </label>
        </div>
        <div className="dp-toggles">
          <label>
            <input
              type="checkbox"
              checked={summer}
              onChange={(e) => setSummer(e.target.checked)}
            />{" "}
            Include Summer
          </label>
          <label>
            <input
              type="checkbox"
              checked={winter}
              onChange={(e) => setWinter(e.target.checked)}
            />{" "}
            Include Winter
          </label>
        </div>
        <button type="submit" disabled={!pdf || loading}>
          {loading ? "Analyzing academic requirements…" : "Generate my plan"}
        </button>
        <p className="dp-small">
          Academic planning aid only. Your PDF is processed in memory; final
          graduation eligibility requires institutional approval.
        </p>
      </form>
      {error && (
        <p role="alert" className="dp-error">
          {error}
        </p>
      )}
      {result && (
        <section aria-live="polite" className="dp-results">
          <h2>Recommended schedule</h2>
          <p>{result.plan.overview}</p>
          <div className="dp-grid">
            {result.plan.semesters
              .filter((term) => term.courses.length > 0)
              .map((term) => (
                <article
                  className="dp-term"
                  key={`${term.year}-${term.season}`}
                >
                  <h3>
                    {term.season} {term.year}
                  </h3>
                  {term.courses.map((course) => (
                    <div className="dp-course" key={course.courseId}>
                      <strong>{course.courseId}</strong>
                      <p>{course.reason}</p>
                    </div>
                  ))}
                </article>
              ))}
          </div>
          <section className="dp-summary">
            <h3>Graduation progress (conditional)</h3>
            <p>
              Last proposed course:{" "}
              {result.finalProposedTerm
                ? `${result.finalProposedTerm.season} ${result.finalProposedTerm.year}`
                : "None scheduled"}
              . This is <strong>not</strong> a confirmed graduation date.
            </p>
            <p>
              Projected degree credits:{" "}
              <strong>
                {credits?.projectedTotalIfCoursesCount ?? "unknown"}
                {credits ? ` / ${credits.required}` : ""}
              </strong>
              {credits?.remainingIfKnown !== null &&
              credits?.remainingIfKnown !== undefined
                ? ` · ${credits.remainingIfKnown} still needed`
                : ""}
            </p>
            <p>
              {result.coverage.missing.length} missing requirement(s) ·{" "}
              {result.coverage.uncertain.length} conditional/unverified.
            </p>
            {result.coverage.missing.length > 0 && (
              <ul>
                {result.coverage.missing.map((r) => (
                  <li key={r.requirementId}>
                    <strong>{r.requirementId}:</strong> {r.explanation}
                  </li>
                ))}
              </ul>
            )}
            {result.revision.attempted && (
              <p className="dp-small">AI revision: {result.revision.note}</p>
            )}
            {!result.validation.canDisplayProvisionalPlan && (
              <p className="dp-error">
                This draft has blocking validation errors. Do not use it as an
                enrollment plan.
              </p>
            )}
          </section>
          <details>
            <summary>Unverified requirements and prerequisite checks</summary>
            <ul>
              {result.coverage.uncertain.map((r) => (
                <li key={r.requirementId}>
                  {r.requirementId}: {r.explanation}
                </li>
              ))}
            </ul>
            <ul>
              {result.prerequisites.map((p, i) => (
                <li key={`${i}-${p.courseId}`}>
                  {p.courseId}: {p.result} — {p.note}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </main>
  );
}
