import { db } from "../db/pool.ts";
import type { AcademicAudit } from "./audit-schema.ts";
import type { AiPlan } from "./ai-plan-schema.ts";

export interface CourseCandidate {
  courseId: string;
  title: string;
  credits: number | null;
  forRequirementId: string;
}

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s*\.\s*/g, " ")
    .replace(/\s+/g, " ");

/** Only supply catalog IDs matching course-range requirements actually in the audit.
 * A catalog record does NOT establish degree eligibility, prerequisites, or offerings.
 */
export async function getRangeCourseCandidates(
  audit: AcademicAudit,
  plan: AiPlan,
): Promise<CourseCandidate[]> {
  const unavailable = new Set([
    ...audit.courses
      .filter((c) => c.status === "completed" || c.status === "in_progress")
      .map((c) => norm(c.courseId)),
    ...plan.semesters.flatMap((s) => s.courses).map((c) => norm(c.courseId)),
  ]);
  const out: CourseCandidate[] = [];
  for (const req of audit.requirements) {
    if (req.rule.kind !== "course_range" || req.status === "complete") continue;
    const rule = req.rule;
    const alreadyScheduled = plan.semesters
      .flatMap((s) => s.courses)
      .filter((c) => c.requirementIds.includes(req.id)).length;
    if (alreadyScheduled >= rule.count) continue;
    const subject = norm(rule.subject);
    // Parameterized by subject; never interpolate audit text into SQL.
    const result = await db.query<{
      id: string;
      title: string;
      credits: string | null;
    }>(
      "SELECT id, title, credits FROM public.courses WHERE id LIKE $1 ORDER BY id",
      [`${subject} %`],
    );
    const options = result.rows.flatMap((row) => {
      const id = norm(row.id);
      const match = /^([A-Z&]+)\s+(\d{1,4})(?:[A-Z])?$/.exec(id);
      if (
        !match ||
        match[1] !== subject ||
        +match[2] < rule.minNumber ||
        +match[2] > rule.maxNumber ||
        unavailable.has(id)
      )
        return [];
      const n = row.credits === null ? null : Number(row.credits);
      return [
        {
          courseId: id,
          title: row.title,
          credits: n !== null && Number.isFinite(n) && n > 0 ? n : null,
          forRequirementId: req.id,
        },
      ];
    });
    // Put known 4+ credit choices first: can matter for a small remaining gap.
    options.sort(
      (a, b) =>
        (b.credits ?? 0) - (a.credits ?? 0) ||
        a.courseId.localeCompare(b.courseId),
    );
    out.push(...options.slice(0, 20));
  }
  return out;
}
