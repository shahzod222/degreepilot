import type { AiPlan, PlanningPreferences } from "./ai-plan-schema.ts";
import type { PlanValidationReport } from "./plan-validator.ts";
import type { DbPlanCheck } from "./plan-db-checks.ts";

export interface RevisionFinding {
  code: string;
  requirementId: string | null;
  message: string;
}

export function lastScheduledTermIndex(plan: AiPlan): number {
  for (let i = plan.semesters.length - 1; i >= 0; i--) {
    if (plan.semesters[i].courses.length) return i;
  }
  return -1;
}

/** Distinguish actionable omissions from ordinary IP/complex-rule warnings. */
export function actionablePlanFeedback(
  plan: AiPlan,
  report: PlanValidationReport,
  prefs: PlanningPreferences,
  prerequisites: DbPlanCheck["prerequisites"] = [],
): RevisionFinding[] {
  const findings: RevisionFinding[] = [];
  for (const issue of report.errors) {
    findings.push({ code: issue.code, requirementId: null, message: `${issue.path}: ${issue.message}` });
  }
  for (const r of report.graduationCoverage.missing) {
    findings.push({
      code: r.ruleKind === "credit_minimum" ? "CREDIT_SHORTFALL" : "MISSING_REQUIREMENT",
      requirementId: r.requirementId,
      message: r.explanation,
    });
  }
  for (const p of prerequisites) {
    if (p.result === "missing") {
      findings.push({ code: "STORED_PREREQUISITE_MISSING", requirementId: null,
        message: `${p.courseId}: a required prerequisite is missing under stored rules. Do not schedule until resolved.` });
    }
  }

  // User asked for EARLIEST feasible graduation, not aesthetic spreading.
  // If even the capacity-only lower bound is earlier than the current last term,
  // invite a single revision. Prerequisites may still prevent compaction.
  const courseCount = plan.semesters.reduce((n, t) => n + t.courses.length, 0);
  const earliestCapacityEnd = Math.ceil(courseCount / prefs.maxCoursesPerSemester) - 1;
  const last = lastScheduledTermIndex(plan);
  if (courseCount > 0 && last > earliestCapacityEnd) {
    findings.push({ code: "POSSIBLY_DELAYED_SCHEDULE", requirementId: null,
      message: `The last proposed course is in term ${last + 1}; course-count capacity could fit them in ${earliestCapacityEnd + 1} term(s). Move courses earlier ONLY if prerequisite sequencing and other constraints allow.` });
  }
  return findings;
}

function quality(plan: AiPlan, report: PlanValidationReport): number[] {
  const missingCourses = report.graduationCoverage.missing
    .filter(r => r.ruleKind !== "credit_minimum")
    .reduce((total, r) => total + (r.missingCourseSlots ?? 1), 0);
  const unknownCredit = report.graduationCoverage.degreeCredits?.remainingIfKnown === null ||
    report.graduationCoverage.degreeCredits === null ? 1 : 0;
  const creditGap = report.graduationCoverage.degreeCredits?.remainingIfKnown ?? 99999;
  const extraMissing = report.graduationCoverage.missing.filter(
    r => r.ruleKind !== "credit_minimum" && r.missingCourseSlots === undefined
  ).length;
  return [
    report.errors.length,
    missingCourses,
    extraMissing,
    unknownCredit,
    creditGap,
    // Only after coverage, favor an earlier final proposed course.
    Math.max(-1, lastScheduledTermIndex(plan)),
  ];
}

/** Accept a revision only when it is strictly better on validated objectives. */
export function isRevisedPlanBetter(
  original: {plan: AiPlan; validation: PlanValidationReport},
  revised: {plan: AiPlan; validation: PlanValidationReport},
): boolean {
  const a = quality(original.plan, original.validation);
  const b = quality(revised.plan, revised.validation);
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false;
    if (b[i] < a[i]) return true;
  }
  return false;
}
