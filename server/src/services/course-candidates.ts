import { db } from "../db/pool.ts";
import type { AcademicAudit } from "./audit-schema.ts";
import type { AiPlan } from "./ai-plan-schema.ts";
import { isOverallDegreeCredits } from "./graduation-coverage.ts";

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

/**
 * Fetch CATALOG facts for explicitly required/choice courses AND candidates for
 * outstanding course-number ranges BEFORE the initial LLM call.
 * Passing an optional plan also excludes courses already selected in that plan.
 * A DB record establishes course ID and catalog credits ONLY: not section eligibility,
 * prerequisites, residency, term offering, or graduation approval.
 */
export async function getRangeCourseCandidates(
  audit: AcademicAudit,
  plan?: AiPlan,
): Promise<CourseCandidate[]> {
  const unavailable = new Set([
    ...audit.courses
      .filter((c) =>
        ["completed", "in_progress", "not_allowed"].includes(c.status),
      )
      .map((c) => norm(c.courseId)),
    ...(plan?.semesters
      .flatMap((s) => s.courses)
      .map((c) => norm(c.courseId)) ?? []),
  ]);
  const output: CourseCandidate[] = [];
  const potentialDegreeElectives = new Map<string, CourseCandidate>();
  // Give the model catalog credits for explicit courses too; otherwise it cannot
  // reason accurately about how a selected core/choose-N course affects the total.
  const specified = audit.requirements.filter(
    (req) =>
      req.status === "still_needed" &&
      (req.rule.kind === "required_course" ||
        req.rule.kind === "choose_courses"),
  );
  const explicitIds = [
    ...new Set(
      specified.flatMap((req) => {
        if (req.rule.kind === "required_course")
          return [norm(req.rule.courseId)];
        if (req.rule.kind === "choose_courses")
          return req.rule.options.map(norm);
        return [];
      }),
    ),
  ].filter((id) => !unavailable.has(id));
  const facts = new Map<string, { title: string; credits: number | null }>();
  if (explicitIds.length) {
    const result = await db.query<{
      id: string;
      title: string;
      credits: string | number | null;
    }>(
      "SELECT id, title, credits FROM public.courses WHERE id = ANY($1::text[])",
      [explicitIds],
    );
    for (const row of result.rows) {
      const value = row.credits === null ? null : Number(row.credits);
      facts.set(norm(row.id), {
        title: row.title,
        credits:
          value !== null && Number.isFinite(value) && value > 0 ? value : null,
      });
    }
  }
  for (const req of specified) {
    const ids =
      req.rule.kind === "required_course"
        ? [norm(req.rule.courseId)]
        : req.rule.kind === "choose_courses"
          ? req.rule.options.map(norm)
          : [];
    for (const id of ids) {
      const fact = facts.get(id);
      if (fact)
        output.push({
          courseId: id,
          title: fact.title,
          credits: fact.credits,
          forRequirementId: req.id,
        });
    }
  }

  for (const req of audit.requirements) {
    if (req.rule.kind !== "course_range" || req.status !== "still_needed")
      continue;
    const rule = req.rule;
    const alreadyScheduled =
      plan?.semesters
        .flatMap((s) => s.courses)
        .filter((c) => c.requirementIds.includes(req.id)).length ?? 0;
    if (alreadyScheduled >= rule.count) continue;

    const subject = norm(rule.subject);
    const result = await db.query<{
      id: string;
      title: string;
      credits: string | number | null;
    }>(
      "SELECT id, title, credits FROM public.courses WHERE id LIKE $1 ORDER BY id",
      [`${subject} %`],
    );
    const possible = result.rows.flatMap((row) => {
      const id = norm(row.id);
      const match = /^([A-Z&]+)\s+(\d{1,4})(?:[A-Z])?$/.exec(id);
      if (
        !match ||
        match[1] !== subject ||
        Number(match[2]) < rule.minNumber ||
        Number(match[2]) > rule.maxNumber ||
        unavailable.has(id)
      )
        return [];
      const value = row.credits === null ? null : Number(row.credits);
      return [
        {
          courseId: id,
          title: row.title,
          credits:
            value !== null && Number.isFinite(value) && value > 0
              ? value
              : null,
          forRequirementId: req.id,
        },
      ];
    });
    // Known higher-credit options may help a small credit shortfall, but they are
    // NEVER automatically deemed eligible. Stable sorting makes prompts repeatable.
    possible.sort(
      (a, b) =>
        (b.credits ?? 0) - (a.credits ?? 0) ||
        a.courseId.localeCompare(b.courseId),
    );
    output.push(...possible.slice(0, 20));
    // Existing audit-mentioned course ranges are potential extra credits,
    // not proof that the institution will allow those credits to count.
    for (const candidate of possible) {
      if (candidate.credits === null || candidate.credits <= 0) continue;
      if (explicitIds.includes(candidate.courseId)) continue;
      potentialDegreeElectives.set(candidate.courseId, candidate);
    }
  }
  // Complex requirements may explicitly name courses even when the
  // category itself cannot be reduced to a single choose-N rule.
  const complex = audit.requirements.filter(
    (req) => req.status === "still_needed" && req.rule.kind === "complex",
  );
  const complexIds = complex.flatMap((req) => {
    const source = `${req.originalText} ${req.rule.kind === "complex" ? req.rule.description : ""}`;
    const matches = [...source.toUpperCase().matchAll(/\b([A-Z]{2,7})\s+(\d{3,4}[A-Z]?)\b/g)];
    return matches.map((m) => ({ id: norm(`${m[1]} ${m[2]}`), reqId: req.id }));
  }).filter((candidate) => !unavailable.has(candidate.id));
  if (complexIds.length) {
    const ids = [...new Set(complexIds.map((c) => c.id))];
    const result = await db.query<{
      id: string; title: string; credits: string | number | null;
    }>(
      "SELECT id, title, credits FROM public.courses WHERE id = ANY($1::text[])",
      [ids],
    );
    const known = new Map(result.rows.map((row) => [norm(row.id), row]));
    for (const c of complexIds) {
      const row = known.get(c.id);
      if (!row) continue;
      const credits = row.credits === null ? null : Number(row.credits);
      output.push({
        courseId: c.id,
        title: row.title,
        credits: credits !== null && Number.isFinite(credits) && credits > 0 ? credits : null,
        forRequirementId: c.reqId,
      });
    }
  }

  const totalDegree = audit.requirements.find(
    (req) =>
      req.status === "still_needed" &&
      req.rule.kind === "credit_minimum" &&
      isOverallDegreeCredits(req) &&
      req.rule.applied !== null &&
      req.rule.required > req.rule.applied,
  );
  if (totalDegree) {
    // A small, bounded list of real catalog entries from ranges mentioned
    // in this audit. Each additional recommendation must stay provisional.
    const candidates = [...potentialDegreeElectives.values()]
      .sort((a, b) => (b.credits ?? 0) - (a.credits ?? 0) || a.courseId.localeCompare(b.courseId))
      .slice(0, 15);
    for (const candidate of candidates)
      output.push({ ...candidate, forRequirementId: totalDegree.id });
  }
  return output;
}
