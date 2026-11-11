import {
  allowedTwoYearTerms,
  termCourseLimit,
  type AiPlan,
  type PlanningPreferences,
} from "./ai-plan-schema.ts";
import type { CourseCandidate } from "./course-candidates.ts";
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

const isCourseSlot = (kind: string) =>
  kind === "required_course" ||
  kind === "choose_courses" ||
  kind === "course_range";

/** Only send issues the LLM might change by changing selected courses/terms. */
export function actionablePlanFeedback(
  plan: AiPlan,
  report: PlanValidationReport,
  prefs: PlanningPreferences,
  prerequisites: DbPlanCheck["prerequisites"] = [],
  candidates: readonly CourseCandidate[] = [],
): RevisionFinding[] {
  const findings: RevisionFinding[] = [];
  for (const issue of report.errors) {
    findings.push({
      code: issue.code,
      requirementId: null,
      message: `${issue.path}: ${issue.message}`,
    });
  }
  for (const missing of report.graduationCoverage.missing) {
    if (isCourseSlot(missing.ruleKind)) {
      findings.push({
        code: "MISSING_REQUIRED_COURSE_SLOT",
        requirementId: missing.requirementId,
        message: missing.explanation,
      });
    } else if (
      missing.ruleKind === "credit_minimum" &&
      missing.requirementId ===
        report.graduationCoverage.degreeCredits?.requirementId
    ) {
      findings.push({
        code: "DEGREE_CREDIT_SHORTFALL",
        requirementId: missing.requirementId,
        message: `${missing.explanation} First cover all required course slots, then select a verified eligible option if possible. Do not invent electives.`,
      });
    }
    if (
      missing.ruleKind === "complex" &&
      candidates.some((candidate) => candidate.forRequirementId === missing.requirementId)
    ) {
      findings.push({
        code: "COMPLEX_REQUIREMENT_CANDIDATE",
        requirementId: missing.requirementId,
        message: `Consider an audit-grounded catalog candidate for ${missing.requirementId}; category eligibility remains unverified.`,
      });
    }
    // Complex/GPA/residency constraints must remain visible but are not
    // mechanically fixable by inventing courses or assertions.
  }
  for (const p of prerequisites) {
    if (p.result === "missing") {
      findings.push({
        code: "STORED_PREREQUISITE_MISSING",
        requirementId: null,
        message: `${p.courseId}: stored prerequisite not met. Move it later or select another supported course.`,
      });
    }
  }

  const courseCount = plan.semesters.reduce((n, t) => n + t.courses.length, 0);
  let accumulatedCapacity = 0;
  const capacityLowerBound = allowedTwoYearTerms(prefs).findIndex((term) => {
    accumulatedCapacity += termCourseLimit(term, prefs);
    return accumulatedCapacity >= courseCount;
  });
  const last = lastScheduledTermIndex(plan);
  if (courseCount > 0 && capacityLowerBound >= 0 && last > capacityLowerBound) {
    findings.push({
      code: "POSSIBLY_DELAYED_SCHEDULE",
      requirementId: null,
      message: `Current last term index ${last}, capacity-only lower bound ${capacityLowerBound}. Compress only if sequencing and offering uncertainty permit.`,
    });
  }
  return findings;
}

/** Lexicographic: any hard error beats a cosmetically earlier plan. */
export function planQuality(
  plan: AiPlan,
  report: PlanValidationReport,
): number[] {
  const mandatoryMissing = report.graduationCoverage.missing
    .filter((r) => isCourseSlot(r.ruleKind))
    .reduce((sum, r) => sum + (r.missingCourseSlots ?? 1), 0);
  const complexMissing = report.graduationCoverage.missing.filter((r) => r.ruleKind === "complex").length;
  const degree = report.graduationCoverage.degreeCredits;
  const missingCreditValues = degree?.missingCreditValuesFor.length ?? 0;
  const remaining = degree?.remainingIfKnown;
  const unknownCredit = degree === null || remaining === null ? 1 : 0;
  return [
    report.errors.length,
    mandatoryMissing,
    unknownCredit,
    missingCreditValues,
    remaining ?? 99999,
    complexMissing,
    // Earlier completion matters after mandatory slots and credits.
    lastScheduledTermIndex(plan),
  ];
}

export function isRevisedPlanBetter(
  original: { plan: AiPlan; validation: PlanValidationReport },
  revised: { plan: AiPlan; validation: PlanValidationReport },
): boolean {
  const a = planQuality(original.plan, original.validation);
  const b = planQuality(revised.plan, revised.validation);
  for (let i = 0; i < a.length; i++) {
    if (b[i] < a[i]) return true;
    if (b[i] > a[i]) return false;
  }
  return false;
}

export function revisionComparisonNote(
  original: { plan: AiPlan; validation: PlanValidationReport },
  revised: { plan: AiPlan; validation: PlanValidationReport },
): string {
  const [initialErrors, initialSlots, , , initialGap] = planQuality(
    original.plan,
    original.validation,
  );
  const [newErrors, newSlots, , , newGap] = planQuality(
    revised.plan,
    revised.validation,
  );
  return `Revision rejected after validation (errors ${initialErrors}→${newErrors}; missing course slots ${initialSlots}→${newSlots}; projected credit gap ${initialGap === 99999 ? "unknown" : initialGap}→${newGap === 99999 ? "unknown" : newGap}). Kept the stronger original plan.`;
}
