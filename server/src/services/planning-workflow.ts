import type { AcademicAudit } from "./audit-schema.ts";
import type { AuditValidationReport } from "./audit-validator.ts";
import {
  allowedTwoYearTerms,
  PlanningPreferencesSchema,
  type AiPlan,
  type PlanningPreferences,
} from "./ai-plan-schema.ts";
import { generateAiProvisionalPlan } from "./ai-planner.ts";
import {
  validateProposedPlanWithDb,
  type DbPlanCheck,
} from "./plan-db-checks.ts";
import {
  getRangeCourseCandidates,
  type CourseCandidate,
} from "./course-candidates.ts";
import { reviseAiPlanOnce } from "./revise-ai-plan.ts";
import {
  actionablePlanFeedback,
  isRevisedPlanBetter,
  lastScheduledTermIndex,
} from "./plan-review.ts";

export interface VerifiedPlanningResult {
  plan: AiPlan;
  validation: DbPlanCheck["validation"];
  prerequisites: DbPlanCheck["prerequisites"];
  missingDatabaseCreditValues: string[];
  finalProposedTerm: { year: number; season: string } | null;
  /** Even if all slots are scheduled, unresolved category policies/IP statuses preclude certification. */
  graduationStatus: "requirements_missing" | "needs_verification";
  revision: {
    attempted: boolean;
    accepted: boolean;
    note: string;
  };
  model: string;
  tokenUsage: { input: number; output: number };
}

/** Override dependencies for fast offline tests. Production calls the actual API and DB. */
export interface PlanningDependencies {
  generateInitial: typeof generateAiProvisionalPlan;
  checkWithDb: typeof validateProposedPlanWithDb;
  candidates: typeof getRangeCourseCandidates;
  revise: typeof reviseAiPlanOnce;
}
const defaults: PlanningDependencies = {
  generateInitial: generateAiProvisionalPlan,
  checkWithDb: validateProposedPlanWithDb,
  candidates: getRangeCourseCandidates,
  revise: reviseAiPlanOnce,
};

/** Initial AI plan → DB/coverage validation → at most ONE AI revision → DB revalidation → best safe result. */
export async function generateReviewedTwoYearPlan(
  audit: AcademicAudit,
  auditValidation: AuditValidationReport,
  rawPreferences: PlanningPreferences,
  deps: PlanningDependencies = defaults,
): Promise<VerifiedPlanningResult> {
  if (!auditValidation.canDraftPlan)
    throw new Error("Audit has blocking extraction errors.");
  const preferences = PlanningPreferencesSchema.parse(rawPreferences);
  const initial = await deps.generateInitial(
    audit,
    auditValidation,
    preferences,
  );
  let current: AiPlan = initial.plan;
  let check = await deps.checkWithDb(current, audit, preferences);
  let tokenInput = initial.tokenUsage.input ?? 0;
  let tokenOutput = initial.tokenUsage.output ?? 0;
  const feedback = actionablePlanFeedback(
    current,
    check.validation,
    preferences,
    check.prerequisites,
  );
  let attempted = false;
  let accepted = false;
  let note = "No fixable omissions or obvious scheduling delays found.";
  let model = initial.model;

  if (feedback.length) {
    attempted = true;
    try {
      const choices: CourseCandidate[] = await deps.candidates(audit, current);
      const improved = await deps.revise({
        audit,
        preferences,
        currentPlan: current,
        findings: feedback,
        dbCheck: check,
        catalogCandidates: choices,
      });
      tokenInput += improved.tokenUsage.input ?? 0;
      tokenOutput += improved.tokenUsage.output ?? 0;
      const revisedCheck = await deps.checkWithDb(
        improved.plan,
        audit,
        preferences,
      );
      if (
        isRevisedPlanBetter(
          { plan: current, validation: check.validation },
          { plan: improved.plan, validation: revisedCheck.validation },
        )
      ) {
        current = improved.plan;
        check = revisedCheck;
        accepted = true;
        model = improved.model;
        note =
          "Revision improved validated requirement coverage, credit projection, or scheduling speed.";
      } else {
        note =
          "Revision did not improve validated results; kept the original plan.";
      }
    } catch (error) {
      // No repeated model calls: preserve the first draft with all its warnings.
      note = `Revision unavailable; kept the original plan. ${error instanceof Error ? error.message : "Unexpected error."}`;
    }
  }

  const i = lastScheduledTermIndex(current);
  const last = i >= 0 ? current.semesters[i] : null;
  const status =
    check.validation.graduationCoverage.missing.length > 0
      ? ("requirements_missing" as const)
      : ("needs_verification" as const);
  return {
    plan: current,
    validation: check.validation,
    prerequisites: check.prerequisites,
    missingDatabaseCreditValues: check.missingDatabaseCreditValues,
    finalProposedTerm: last ? { year: last.year, season: last.season } : null,
    graduationStatus: status,
    revision: { attempted, accepted, note },
    model,
    tokenUsage: { input: tokenInput, output: tokenOutput },
  };
}
