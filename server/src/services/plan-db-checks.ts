import { db } from "../db/pool.ts";
import { checkPrerequisites } from "./prerequisites.ts";
import type { AcademicAudit } from "./audit-schema.ts";
import type { AiPlan, PlanningPreferences } from "./ai-plan-schema.ts";
import {
  validateProposedPlan,
  type PlanValidationReport,
} from "./plan-validator.ts";

export interface DbPlanCheck {
  validation: PlanValidationReport;
  prerequisites: Array<{
    courseId: string;
    result: "satisfied" | "missing" | "needs_review" | "unknown";
    note: string;
  }>;
  missingDatabaseCreditValues: string[];
}

const norm = (id: string) =>
  id
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s*\.\s*/g, " ")
    .replace(/\s+/g, " ");

/**
 * Optional second pass: use existing courses and prerequisite tables.
 * The DB is an aid, not an authoritative degree audit or course-offering source.
 */
export async function validateProposedPlanWithDb(
  plan: AiPlan,
  audit: AcademicAudit,
  prefs: PlanningPreferences,
): Promise<DbPlanCheck> {
  const planned = plan.semesters
    .flatMap((s) => s.courses)
    .map((c) => norm(c.courseId));
  const unique = [...new Set(planned)];
  const result = await db.query<{ id: string; credits: string | null }>(
    "SELECT id, credits FROM public.courses WHERE id = ANY($1::text[])",
    [unique],
  );
  const credits = new Map<string, number>();
  const catalogIds = new Set(result.rows.map((row) => norm(row.id)));
  for (const row of result.rows) {
    if (row.credits === null) continue;
    const value = Number(row.credits);
    if (Number.isFinite(value) && value >= 0) credits.set(norm(row.id), value);
  }

  const originalCompleted = new Set(
    audit.courses
      .filter((c) => c.status === "completed")
      .map((c) => norm(c.courseId)),
  );
  // Only include IP coursework from terms BEFORE planning begins.
  // A current/future IP course cannot unlock a same-term or earlier course.
  const seasonIndex: Record<string, number> = {
    WINTER: 0,
    SPRING: 1,
    SUMMER: 2,
    FALL: 3,
  };
  const start =
    prefs.startTerm.year * 4 +
    seasonIndex[prefs.startTerm.season.toUpperCase()];
  const eligibleIp = new Set(
    audit.courses
      .filter((c) => {
        if (c.status !== "in_progress" || !c.term) return false;
        const m = /(WINTER|SPRING|SUMMER|FALL)\s*(\d{4})/i.exec(c.term);
        return (
          !!m && Number(m[2]) * 4 + seasonIndex[m[1].toUpperCase()] < start
        );
      })
      .map((c) => norm(c.courseId)),
  );
  const previousAssumed = new Set([...originalCompleted, ...eligibleIp]);
  const prerequisites: DbPlanCheck["prerequisites"] = [];

  for (const semester of plan.semesters) {
    // No same-term course can count as another course's prerequisite.
    for (const course of semester.courses) {
      const id = norm(course.courseId);
      const checked = await checkPrerequisites(id, [...previousAssumed]);
      let note =
        checked.status === "satisfied"
          ? "Stored rules satisfied under assumed successful completion of prior/IP courses."
          : "Stored prerequisite rules are incomplete, not satisfied, or need review.";
      if (checked.status === "satisfied" && eligibleIp.size) {
        const withoutIp = await checkPrerequisites(id, [
          ...new Set([...previousAssumed].filter((c) => !eligibleIp.has(c))),
        ]);
        if (withoutIp.status !== "satisfied")
          note = "Depends on in-progress coursework passing; conditional.";
      }
      prerequisites.push({
        courseId: id,
        result: checked.status as DbPlanCheck["prerequisites"][number]["result"],
        note,
      });
    }
    for (const course of semester.courses)
      previousAssumed.add(norm(course.courseId));
  }

  const validation = validateProposedPlan(plan, audit, prefs, credits, true);
  // Course-number ranges alone do not establish a real catalog course.
  // Explicitly listed audit options can be absent from our incomplete catalog;
  // treat those as unknown rather than automatically invalid.
  for (const [si, semester] of plan.semesters.entries()) {
    for (const [ci, course] of semester.courses.entries()) {
      const id = norm(course.courseId);
      const isRangeOnly = course.requirementIds.some((reqId) => {
        const req = audit.requirements.find((r) => r.id === reqId);
        return req?.rule.kind === "course_range";
      });
      if (isRangeOnly && !catalogIds.has(id)) {
        validation.errors.push({
          severity: "error",
          code: "RANGE_COURSE_NOT_IN_DB",
          path: `semesters[${si}].courses[${ci}]`,
          message: `${id} matches a range but isn't in the known course catalog. Do not invent course IDs.`,
        });
      }
    }
  }

  for (const p of prerequisites) {
    if (p.result === "missing") {
      validation.errors.push({
        severity: "error",
        code: "STORED_PREREQUISITE_MISSING",
        path: `course:${p.courseId}`,
        message: `Missing prerequisite under stored rules: ${p.note}`,
      });
    }
    if (p.result !== "satisfied" || p.note.includes("conditional")) {
      validation.warnings.push({
        severity: "warning",
        code:
          p.result === "satisfied"
            ? "PREREQUISITE_DEPENDS_ON_IP"
            : "PREREQUISITE_REVIEW",
        path: `course:${p.courseId}`,
        message: `${p.result}: ${p.note}`,
      });
    }
  }
  validation.canDisplayProvisionalPlan = validation.errors.length === 0;
  return {
    validation,
    prerequisites,
    missingDatabaseCreditValues: unique.filter((id) => !credits.has(id)),
  };
}
