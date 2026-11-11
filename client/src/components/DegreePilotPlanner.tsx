import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import "./DegreePilotPlanner.css";
import "./DegreePilotSample.css";

type ProposedCourse = {
  courseId: string;
  reason: string;
  prerequisiteNote?: string;
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

type IconName =
  | "file"
  | "upload"
  | "check"
  | "x"
  | "arrow"
  | "spark"
  | "shield"
  | "calendar"
  | "alert"
  | "chevron"
  | "eye"
  | "eye-off";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  const shapes: Record<IconName, ReactNode> = {
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h6" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-4 4 4-4 4 4" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    x: <path d="M18 6 6 18M6 6l12 12" />,
    arrow: (
      <>
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3Z" />
        <path d="m19 17 .5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5L19 17Z" />
      </>
    ),
    shield: (
      <>
        <path d="m12 22 6.5-3.6a3 3 0 0 0 1.5-2.6V6l-8-4-8 4v9.8a3 3 0 0 0 1.5 2.6L12 22Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18" />
      </>
    ),
    alert: (
      <>
        <path d="m10.3 3.8-8.1 14a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3l-8.1-14a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4m0 4h.01" />
      </>
    ),
    chevron: <path d="m6 9 6 6 6-6" />,
    eye: (
      <>
        <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    "eye-off": (
      <>
        <path d="m3 3 18 18M10.5 5.6A11.5 11.5 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a15.2 15.2 0 0 1-3.5 4.2M6.1 6.3C3.5 8.2 2 12 2 12s3.5 6.5 10 6.5c1.6 0 3-.4 4.3-1" />
        <path d="M10 10a3 3 0 0 0 4 4" />
      </>
    ),
  };
  return <svg {...common}>{shapes[name]}</svg>;
}

const apiBase = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001"
).replace(/\/$/, "");
// Vercel Functions have a 4.5 MB request-body limit. Leave headroom for multipart overhead.
const maxPdfBytes = 4 * 1024 * 1024;
// Vite serves files in /public from the site root (including configured base paths).
const samplePdfUrl = `${import.meta.env.BASE_URL}sample-degreeworks.pdf`;
const seasonOrder: Record<string, number> = {
  Winter: 0,
  Spring: 1,
  Summer: 2,
  Fall: 3,
};
const readableId = (id: string) => id.replace(/-/g, " ");
const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatElapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function DegreePilotPlanner() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [maxCourses, setMaxCourses] = useState(3);
  const [summer, setSummer] = useState(false);
  const [winter, setWinter] = useState(false);
  const [startSeason, setStartSeason] = useState("Fall");
  const [startYear, setStartYear] = useState(2027);
  const [demoCode, setDemoCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const workingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Keep the browser tab and on-page brand consistent with the SVG favicon.
    document.title = "DegreePilot AI — Academic Roadmap";
  }, []);

  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (loading) {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      workingRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
    }
  }, [loading]);

  useEffect(() => {
    if (result)
      resultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [result]);

  function invalidateResult() {
    setResult(null);
    setError("");
  }

  function choosePdf(candidate: File | null) {
    if (loading) return;
    invalidateResult();
    if (!candidate) {
      setPdf(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (
      !candidate.name.toLowerCase().endsWith(".pdf") ||
      (candidate.type && candidate.type !== "application/pdf")
    ) {
      setError("Please choose a PDF file.");
      setPdf(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (candidate.size > maxPdfBytes) {
      setError("This PDF exceeds the 4 MB upload limit for the online demo.");
      setPdf(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (candidate.size === 0) {
      setError("This PDF is empty. Choose a different file.");
      setPdf(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setPdf(candidate);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!loading && !sampleLoading)
      choosePdf(event.dataTransfer.files[0] ?? null);
  }

  async function useSamplePdf() {
    if (loading || sampleLoading) return;
    setSampleLoading(true);
    setError("");
    try {
      const response = await fetch(samplePdfUrl);
      if (!response.ok)
        throw new Error(
          `Could not load the sample PDF (HTTP ${response.status}).`,
        );

      const blob = await response.blob();
      if (!blob.size) throw new Error("The sample PDF is empty.");

      // Use the exact validation and state handling as an uploaded PDF.
      const sample = new File([blob], "sample-degreeworks.pdf", {
        type: "application/pdf",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      choosePdf(sample);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the sample PDF.",
      );
    } finally {
      setSampleLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pdf || loading || sampleLoading) return;
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
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body?.error ??
            `The request could not be completed (HTTP ${response.status}).`,
        );
      }
      if (!body?.plan?.semesters || !body?.coverage)
        throw new Error(
          "The server returned an incomplete plan. Please try again.",
        );
      setResult(body as PlanResponse);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  const credits = result?.coverage.degreeCredits;
  const semesters = [...(result?.plan.semesters ?? [])]
    .filter((term) => term.courses.length > 0)
    .sort(
      (a, b) =>
        a.year - b.year ||
        (seasonOrder[a.season] ?? 99) - (seasonOrder[b.season] ?? 99),
    );
  const totalCourses = semesters.reduce(
    (sum, term) => sum + term.courses.length,
    0,
  );
  const percentage =
    credits?.projectedTotalIfCoursesCount != null && credits.required > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (credits.projectedTotalIfCoursesCount / credits.required) * 100,
          ),
        )
      : null;

  return (
    <main className="dp-page">
      <div className="dp-brand" aria-label="DegreePilot AI">
        <img
          className="dp-brand-mark"
          src="/favicon.svg?v=2"
          alt=""
          aria-hidden="true"
          width="34"
          height="34"
        />
        <span>
          DEGREEPILOT <b>AI</b>
        </span>
      </div>

      <header className="dp-header">
        <p className="dp-kicker">YOUR ACADEMIC ROADMAP</p>
        <h1>
          Your next two years, <em>thoughtfully planned.</em>
        </h1>
        <p>
          Upload your DegreeWorks audit. Get a personalized course roadmap with
          graduation requirements and credit gaps clearly explained.
        </p>
      </header>

      <form onSubmit={submit} className="dp-panel dp-form" aria-busy={loading}>
        <div className="dp-panel-top">
          <div>
            <h2>Build your roadmap</h2>
            <p>Start with your DegreeWorks PDF and a few preferences.</p>
          </div>
          <span className="dp-step-label">01 / SETUP</span>
        </div>

        <div
          className={`dp-upload ${dragging ? "dp-upload-dragging" : ""} ${pdf ? "dp-upload-ready" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!loading && !sampleLoading) setDragging(true);
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragging(false);
          }}
          onDrop={onDrop}
        >
          <input
            id="dp-pdf"
            ref={fileInputRef}
            className="dp-file-native"
            type="file"
            accept=".pdf,application/pdf"
            disabled={loading || sampleLoading}
            onChange={(event) => choosePdf(event.target.files?.[0] ?? null)}
            aria-label="Upload DegreeWorks PDF"
          />
          {pdf ? (
            <div className="dp-file-ready" role="status">
              <span className="dp-file-illustration">
                <Icon name="file" size={25} />
              </span>
              <div className="dp-file-copy">
                <strong title={pdf.name}>{pdf.name}</strong>
                <span>
                  <Icon name="check" size={14} /> PDF ready ·{" "}
                  {formatBytes(pdf.size)}
                </span>
              </div>
              <div className="dp-file-actions">
                <button
                  type="button"
                  className="dp-ghost-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || sampleLoading}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="dp-icon-button"
                  aria-label="Remove PDF"
                  title="Remove PDF"
                  onClick={() => choosePdf(null)}
                  disabled={loading || sampleLoading}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>
          ) : (
            <div className="dp-upload-empty">
              <span className="dp-upload-icon">
                <Icon name="upload" size={25} />
              </span>
              <strong>Drop your DegreeWorks PDF here</strong>
              <span>
                or{" "}
                <button
                  type="button"
                  className="dp-text-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || sampleLoading}
                >
                  browse your files
                </button>
              </span>
              <small>PDF only · Max 4 MB</small>
            </div>
          )}
        </div>

        <section className="dp-sample" aria-label="Sample DegreeWorks PDF">
          <div className="dp-sample-divider">
            <span>OR TRY A SAMPLE</span>
          </div>
          <div className="dp-sample-panel">
            <div className="dp-sample-intro">
              <span className="dp-sample-icon" aria-hidden="true">
                <Icon name="file" size={21} />
              </span>
              <div>
                <strong>Don't have a DegreeWorks PDF?</strong>
                <p>Explore DegreePilot with an example academic audit.</p>
              </div>
            </div>
            <div className="dp-sample-actions">
              <button
                type="button"
                className="dp-sample-button"
                disabled={loading || sampleLoading}
                onClick={() => void useSamplePdf()}
              >
                <Icon name="arrow" size={17} />
                {sampleLoading ? "Loading sample…" : "Use sample PDF"}
              </button>
              <a href={samplePdfUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="eye" size={16} /> Preview sample
              </a>
              <a href={samplePdfUrl} download="DegreePilot-Sample.pdf">
                Download PDF
              </a>
            </div>
          </div>
        </section>

        <div className="dp-settings-heading">
          <h3>Planning preferences</h3>
          <span>Keep it flexible</span>
        </div>
        <div className="dp-settings-grid">
          <label className="dp-field" htmlFor="dp-limit">
            Courses per term
            <select
              id="dp-limit"
              value={maxCourses}
              disabled={loading}
              onChange={(e) => {
                setMaxCourses(+e.target.value);
                invalidateResult();
              }}
            >
              {[1, 2, 3, 4].map((n) => (
                <option value={n} key={n}>
                  {n} {n === 1 ? "course" : "courses"}
                </option>
              ))}
            </select>
          </label>
          <label className="dp-field" htmlFor="dp-season">
            Starting season
            <select
              id="dp-season"
              value={startSeason}
              disabled={loading}
              onChange={(e) => {
                setStartSeason(e.target.value);
                invalidateResult();
              }}
            >
              {["Winter", "Spring", "Summer", "Fall"].map((season) => (
                <option key={season}>{season}</option>
              ))}
            </select>
          </label>
          <label className="dp-field" htmlFor="dp-year">
            Starting year
            <input
              id="dp-year"
              type="number"
              min={2026}
              max={2100}
              value={startYear}
              disabled={loading}
              onChange={(e) => {
                setStartYear(+e.target.value);
                invalidateResult();
              }}
            />
          </label>
          <div className="dp-field dp-password-field">
            <label htmlFor="dp-password">Demo password</label>
            <div className="dp-password-wrap">
              <input
                id="dp-password"
                type={showPassword ? "text" : "password"}
                value={demoCode}
                autoComplete="off"
                placeholder="Enter demo password"
                disabled={loading}
                onChange={(e) => setDemoCode(e.target.value)}
              />
              <button
                type="button"
                className="dp-password-toggle"
                onClick={() => setShowPassword((old) => !old)}
                disabled={loading}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
              </button>
            </div>
          </div>
        </div>
        <div className="dp-toggles" aria-label="Optional sessions">
          <label>
            <input
              type="checkbox"
              checked={summer}
              disabled={loading}
              onChange={(e) => {
                setSummer(e.target.checked);
                invalidateResult();
              }}
            />
            <span>Include Summer</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={winter}
              disabled={loading}
              onChange={(e) => {
                setWinter(e.target.checked);
                invalidateResult();
              }}
            />
            <span>Include Winter</span>
          </label>
        </div>
        <div className="dp-submit-row">
          <button
            className="dp-submit"
            type="submit"
            disabled={!pdf || loading || sampleLoading}
          >
            {loading ? (
              <>
                <span className="dp-spinner" /> Generating your roadmap…
              </>
            ) : (
              <>
                <Icon name="spark" size={18} /> Generate my plan{" "}
                <Icon name="arrow" size={18} />
              </>
            )}
          </button>
          <p>
            <Icon name="shield" size={16} /> Processed privately; results are
            provisional.
          </p>
        </div>
        {loading && (
          <section
            ref={workingRef}
            className="dp-working"
            aria-label="Plan generation is in progress"
          >
            <div className="dp-working-heading">
              <span className="dp-working-icon" aria-hidden="true">
                <img src="/favicon.svg?v=2" alt="" width="39" height="39" />
              </span>
              <div className="dp-working-copy">
                <strong>Building your graduation roadmap</strong>
                <p role="status" aria-live="polite">
                  {elapsedSeconds < 120
                    ? "Your PDF is being analyzed and your course plan is being prepared. Please keep this tab open."
                    : elapsedSeconds < 240
                      ? "Still working. Complex academic rules or an extra AI review can take a little longer."
                      : "This is taking longer than usual. Keep the tab open; any server error will be shown here."}
                </p>
              </div>
              <div
                className="dp-working-clock"
                aria-label={`Elapsed time: ${formatElapsed(elapsedSeconds)}`}
              >
                <small>ELAPSED</small>
                <strong aria-hidden="true">
                  {formatElapsed(elapsedSeconds)}
                </strong>
              </div>
            </div>
            <div className="dp-working-bar" aria-hidden="true">
              <span />
            </div>
            <div
              className="dp-working-steps"
              aria-label="Plan generation tasks"
            >
              <span>
                <Icon name="file" size={16} /> Read DegreeWorks
              </span>
              <span>
                <Icon name="calendar" size={16} /> Create schedule
              </span>
              <span>
                <Icon name="shield" size={16} /> Check requirements
              </span>
            </div>
            <p className="dp-working-footnote">
              Usually around 2–3 minutes. The animation shows that your request
              is pending, not a percentage of completion.
            </p>
          </section>
        )}
        <p className="dp-form-disclaimer">
          Academic planning aid only. Audit text is sent to OpenAI for analysis.
          Course eligibility and graduation require confirmation by your
          institution.
        </p>
      </form>

      {error && (
        <div role="alert" className="dp-error">
          <Icon name="alert" size={19} />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <section className="dp-results" ref={resultsRef} aria-live="polite">
          <div className="dp-results-head">
            <div>
              <p className="dp-kicker">02 / YOUR PLAN</p>
              <h2>Your recommended roadmap</h2>
              <p>
                A proposed path through your remaining coursework, organized by
                semester.
              </p>
            </div>
            <span className="dp-status-label">
              <span /> Provisional plan
            </span>
          </div>

          <section
            className="dp-overview dp-panel"
            aria-label="Roadmap overview"
          >
            <div className="dp-overview-stat">
              <span>Last planned term</span>
              <strong>
                {result.finalProposedTerm
                  ? `${result.finalProposedTerm.season} ${result.finalProposedTerm.year}`
                  : "Not scheduled"}
              </strong>
            </div>
            <div className="dp-overview-stat">
              <span>Proposed courses</span>
              <strong>{totalCourses}</strong>
            </div>
            <div className="dp-overview-stat">
              <span>Projected credits</span>
              <strong>
                {credits?.projectedTotalIfCoursesCount ?? "Unknown"}
                {credits ? ` / ${credits.required}` : ""}
              </strong>
            </div>
            {percentage !== null && (
              <div className="dp-overview-progress">
                <div
                  className="dp-progress-track"
                  role="progressbar"
                  aria-label="Conditional projected degree-credit progress"
                  aria-valuemin={0}
                  aria-valuemax={credits!.required}
                  aria-valuenow={Math.min(
                    credits!.projectedTotalIfCoursesCount!,
                    credits!.required,
                  )}
                >
                  <span style={{ width: `${percentage}%` }} />
                </div>
                <small>
                  {credits?.remainingIfKnown === 0
                    ? "Credit minimum conditionally met · other requirements may remain"
                    : credits?.remainingIfKnown != null
                      ? `${credits.remainingIfKnown} additional credit${credits.remainingIfKnown === 1 ? "" : "s"} still needed`
                      : "Credit balance requires verification"}
                </small>
              </div>
            )}
          </section>

          {result.plan.overview && (
            <p className="dp-plan-intro">{result.plan.overview}</p>
          )}

          <div className="dp-timeline" aria-label="Proposed semester timeline">
            {semesters.length ? (
              semesters.map((term, index) => (
                <article
                  className="dp-timeline-step"
                  key={`${term.season}-${term.year}`}
                >
                  <div className="dp-time-label">
                    <span>TERM {String(index + 1).padStart(2, "0")}</span>
                    <strong>
                      {term.season} {term.year}
                    </strong>
                    <small>
                      {term.courses.length}{" "}
                      {term.courses.length === 1 ? "course" : "courses"}
                    </small>
                  </div>
                  <div className="dp-timeline-node" aria-hidden="true">
                    <span>{index + 1}</span>
                  </div>
                  <div className="dp-term-card">
                    <div className="dp-term-head">
                      <span>
                        <Icon name="calendar" size={17} />
                        {term.season} {term.year}
                      </span>
                      <small>{term.courses.length} courses</small>
                    </div>
                    <div className="dp-term-courses">
                      {term.courses.map((course) => (
                        <div className="dp-course-row" key={course.courseId}>
                          <div className="dp-course-code">
                            {course.courseId}
                          </div>
                          <p>{course.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <p className="dp-empty-plan">
                No future courses were proposed. Review the outstanding
                requirements below.
              </p>
            )}
            {semesters.length > 0 && (
              <div className="dp-timeline-end">
                <span className="dp-end-dot" aria-hidden="true" />
                <p>
                  <strong>End of proposed coursework</strong>
                  <span>Not a confirmed graduation date</span>
                </p>
              </div>
            )}
          </div>

          <section
            className="dp-checks dp-panel"
            aria-label="Graduation and requirement checks"
          >
            <div className="dp-checks-head">
              <div>
                <p className="dp-kicker">03 / REQUIREMENT CHECK</p>
                <h2>Before you graduate</h2>
              </div>
              <span className="dp-review-count">
                {result.coverage.missing.length} identified gap
                {result.coverage.missing.length === 1 ? "" : "s"}
              </span>
            </div>
            {!result.validation.canDisplayProvisionalPlan && (
              <div className="dp-error dp-blocking">
                <Icon name="alert" size={19} />
                This plan has blocking validation issues and should not be used
                for enrollment advice.
              </div>
            )}
            {result.coverage.missing.length ? (
              <div className="dp-gap-list">
                {result.coverage.missing.map((item) => (
                  <div className="dp-gap" key={item.requirementId}>
                    <span className="dp-gap-icon">
                      <Icon name="alert" size={18} />
                    </span>
                    <div>
                      <strong>{readableId(item.requirementId)}</strong>
                      <p>{item.explanation}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dp-no-gaps">
                <Icon name="check" size={18} />
                No definite gaps detected in the extracted rules. Verification
                items may still remain.
              </p>
            )}
            <div className="dp-caveat">
              <Icon name="shield" size={18} />
              <span>
                Credit totals assume proposed courses count. In-progress grades,
                residency, prerequisites, and official requirement allocations
                still need confirmation.
              </span>
            </div>
            <details className="dp-details">
              <summary>
                <span>
                  Conditions requiring verification{" "}
                  <small>{result.coverage.uncertain.length}</small>
                </span>
                <Icon name="chevron" size={18} />
              </summary>
              <ul>
                {result.coverage.uncertain.length ? (
                  result.coverage.uncertain.map((item) => (
                    <li key={item.requirementId}>
                      <strong>{readableId(item.requirementId)}</strong> —{" "}
                      {item.explanation}
                    </li>
                  ))
                ) : (
                  <li>None reported.</li>
                )}
              </ul>
            </details>
            <details className="dp-details">
              <summary>
                <span>
                  Prerequisite checks{" "}
                  <small>{result.prerequisites.length}</small>
                </span>
                <Icon name="chevron" size={18} />
              </summary>
              <ul>
                {result.prerequisites.length ? (
                  result.prerequisites.map((item, index) => (
                    <li key={`${item.courseId}-${index}`}>
                      <strong>{item.courseId}</strong> — {item.result}:{" "}
                      {item.note}
                    </li>
                  ))
                ) : (
                  <li>No checks were returned.</li>
                )}
              </ul>
            </details>
            {result.revision.attempted && (
              <p className="dp-revision-note">
                <Icon name="spark" size={16} />
                {result.revision.note}
              </p>
            )}
          </section>
        </section>
      )}
      <footer className="dp-footer">
        DegreePilot AI <span aria-hidden="true">·</span> A graduation planning
        assistant, not official academic advisement.
      </footer>
    </main>
  );
}
