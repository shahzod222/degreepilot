import type { AcademicAudit } from "./audit-schema.ts";
import type { AuditValidationReport } from "./audit-validator.ts";
import {
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
import { buildPlanningChecklist } from "./planning-checklist.ts";
import { reviseAiPlanOnce } from "./revise-ai-plan.ts";
import {
  actionablePlanFeedback,
  isRevisedPlanBetter,
  lastScheduledTermIndex,
  revisionComparisonNote,
} from "./plan-review.ts";

export interface VerifiedPlanningResult {
  plan: AiPlan;
  validation: DbPlanCheck["validation"];
  prerequisites: DbPlanCheck["prerequisites"];
  missingDatabaseCreditValues: string[];
  finalProposedTerm: { year: number; season: string } | null;
  graduationStatus: "requirements_missing" | "needs_verification";
  revision: { attempted: boolean; accepted: boolean; note: string };
  model: string;
  tokenUsage: { input: number; output: number };
}

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

const norm = (id: string) =>
  id.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");

/** A catalog-range course must have been on the candidates supplied to the LLM. */
function validateCatalogSelections(
  plan: AiPlan,
  audit: AcademicAudit,
  candidates: CourseCandidate[],
  check: DbPlanCheck,
) {
  const allowed = new Set(
    candidates.map((c) => `${c.forRequirementId}\u0000${norm(c.courseId)}`),
  );
  for (const [si, semester] of plan.semesters.entries()) {
    for (const [ci, course] of semester.courses.entries()) {
      for (const id of course.requirementIds) {
        const req = audit.requirements.find((r) => r.id === id);
        if (req?.rule.kind !== "course_range") continue;
        if (!allowed.has(`${id}\u0000${norm(course.courseId)}`)) {
          check.validation.errors.push({
            severity: "error",
            code: "RANGE_NOT_IN_PROVIDED_CANDIDATES",
            path: `semesters[${si}].courses[${ci}]`,
            message: `${course.courseId} was not among the database candidates supplied for ${id}.`,
          });
        }
      }
    }
  }
  check.validation.canDisplayProvisionalPlan =
    check.validation.errors.length === 0;
}

/**
 * Deterministic checklist + catalog candidates -> 1 AI draft -> DB validation ->
 * at most 1 AI correction -> DB revalidation -> best safe provisional plan.
 * Never claims institutional graduation approval.
 */
export async function generateReviewedTwoYearPlan(
  audit: AcademicAudit,
  auditValidation: AuditValidationReport,
  rawPreferences: PlanningPreferences,
  deps: PlanningDependencies = defaults,
): Promise<VerifiedPlanningResult> {
  if (!auditValidation.canDraftPlan)
    throw new Error("Audit has blocking extraction errors.");
  const preferences = PlanningPreferencesSchema.parse(rawPreferences);
  const checklist = buildPlanningChecklist(audit);
  if (!checklist.length)
    throw new Error("No requirements extracted; cannot draft a reliable plan.");
  // Stage 6 only supplied candidates AFTER the first plan. Stage 7 supplies them NOW.
  // A database failure is not silently papered over with invented candidates.
  const candidates = await deps.candidates(audit);
  const initial = await deps.generateInitial(
    audit,
    auditValidation,
    preferences,
    { checklist, catalogCandidates: candidates },
  );
  let current = initial.plan;
  let check = await deps.checkWithDb(current, audit, preferences, candidates);
  validateCatalogSelections(current, audit, candidates, check);
  let tokenInput = initial.tokenUsage.input ?? 0;
  let tokenOutput = initial.tokenUsage.output ?? 0;
  const feedback = actionablePlanFeedback(
    current,
    check.validation,
    preferences,
    check.prerequisites,
    candidates,
  );
  let attempted = false;
  let accepted = false;
  let note = feedback.length
    ? "Correction not attempted."
    : "No actionable missing slots, credit gaps or obvious delays found.";
  let model = initial.model;

  if (feedback.length) {
    attempted = true;
    try {
      const revised = await deps.revise({
        audit,
        preferences,
        currentPlan: current,
        findings: feedback,
        dbCheck: check,
        catalogCandidates: candidates,
        checklist,
      });
      tokenInput += revised.tokenUsage.input ?? 0;
      tokenOutput += revised.tokenUsage.output ?? 0;
      const revisedCheck = await deps.checkWithDb(
        revised.plan,
        audit,
        preferences,
        candidates,
      );
      validateCatalogSelections(revised.plan, audit, candidates, revisedCheck);
      if (
        isRevisedPlanBetter(
          { plan: current, validation: check.validation },
          { plan: revised.plan, validation: revisedCheck.validation },
        )
      ) {
        current = revised.plan;
        check = revisedCheck;
        model = revised.model;
        accepted = true;
        note =
          "Revision improved mandatory course coverage, credit projection or scheduling speed.";
      } else {
        note = revisionComparisonNote(
          { plan: current, validation: check.validation },
          { plan: revised.plan, validation: revisedCheck.validation },
        );
      }
    } catch (error) {
      // Preserve the initial result rather than making unbounded calls.
      // Do not echo raw provider/database error details to public users.
      note = "Revision unavailable; original validated plan retained.";
    }
  }
  const lastIndex = lastScheduledTermIndex(current);
  const last = lastIndex >= 0 ? current.semesters[lastIndex] : null;
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
