import type { AcademicAudit } from "./audit-schema.ts";
type AuditRequirement = AcademicAudit["requirements"][number];
import type { AiPlan } from "./ai-plan-schema.ts";

// These are coverage classifications, not official graduation decisions.
export type CoverageStatus =
  | "already_met"
  | "conditional_ip"
  | "planned"
  | "missing"
  | "unverified";

export interface RequirementCoverageItem {
  requirementId: string;
  section: string;
  ruleKind: AuditRequirement["rule"]["kind"];
  status: CoverageStatus;
  supportingCourses: string[];
  explanation: string;
  missingCourseSlots?: number;
  projectedRemainingCredits?: number | null;
}

export interface DegreeCreditsProjection {
  requirementId: string;
  required: number;
  appliedIncludingIP: number;
  knownAdditional: number;
  missingCreditValuesFor: string[];
  projectedTotalIfCoursesCount: number | null;
  remainingIfKnown: number | null;
}

export interface GraduationCoverageReport {
  requirements: RequirementCoverageItem[];
  degreeCredits: DegreeCreditsProjection | null;
  missing: RequirementCoverageItem[];
  uncertain: RequirementCoverageItem[];
  extractedRequirementCount: number;
  assessedRequirementCount: number;
  allExtractedRequirementsConditionallyCovered: boolean;
  unresolvedAuditNotes: number;
  canCertifyGraduation: false;
}

const normalize = (id: string) =>
  id
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s*\.\s*/g, " ")
    .replace(/\s+/g, " ");

const matchesRange = (
  id: string,
  subject: string,
  min: number,
  max: number,
) => {
  const m = /^([A-Z&]+)\s+(\d{1,4})(?:[A-Z])?$/.exec(normalize(id));
  return !!m && m[1] === normalize(subject) && +m[2] >= min && +m[2] <= max;
};

function isOverallDegreeCredits(req: AuditRequirement): boolean {
  const context = `${req.id} ${req.section} ${req.originalText}`.toLowerCase();
  // Only a narrow, explicitly degree-wide match. Never mistake a major/residency
  // counter for the overall degree minimum.
  const heading = `${req.id} ${req.section}`.toLowerCase();
  if (
    /major|college option|residency|bs.additional|additional requirements|pathways/.test(
      heading,
    )
  )
    return false;
  return /degree.credit|credit.*degree|degree.*credit|total.credit|bachelor|credits.*graduate/.test(
    context,
  );
}

/**
 * Audit-wide accounting. It never assumes all rules were extracted correctly,
 * and never treats proposed/IP courses as earned credits or approved enrollment.
 * knownCredits should contain only confirmed course credit values (e.g. from DB).
 */
export function assessGraduationCoverage(
  audit: AcademicAudit,
  plan: AiPlan,
  knownCredits: ReadonlyMap<string, number> = new Map(),
): GraduationCoverageReport {
  const planned = plan.semesters
    .flatMap((s) => s.courses)
    .map((c) => ({
      courseId: normalize(c.courseId),
      ids: new Set(c.requirementIds),
    }));
  const normalizedCredits = new Map(
    [...knownCredits].map(([id, n]) => [normalize(id), n]),
  );
  const completed = new Set(
    audit.courses
      .filter((c) => c.status === "completed")
      .map((c) => normalize(c.courseId)),
  );
  const inProgress = new Set(
    audit.courses
      .filter((c) => c.status === "in_progress")
      .map((c) => normalize(c.courseId)),
  );

  const degreeReq = audit.requirements.find(
    (r) => r.rule.kind === "credit_minimum" && isOverallDegreeCredits(r),
  );
  let degreeCredits: DegreeCreditsProjection | null = null;
  if (
    degreeReq?.rule.kind === "credit_minimum" &&
    degreeReq.rule.applied !== null
  ) {
    const unknown: string[] = [];
    let additional = 0;
    for (const c of planned) {
      // An audit's applied total ALREADY includes completed and IP courses.
      if (completed.has(c.courseId) || inProgress.has(c.courseId)) continue;
      const credits = normalizedCredits.get(c.courseId);
      if (credits === undefined || !Number.isFinite(credits) || credits < 0) {
        unknown.push(c.courseId);
      } else {
        additional += credits;
      }
    }
    const projectedTotal = unknown.length
      ? null
      : degreeReq.rule.applied + additional;
    degreeCredits = {
      requirementId: degreeReq.id,
      required: degreeReq.rule.required,
      appliedIncludingIP: degreeReq.rule.applied,
      knownAdditional: additional,
      missingCreditValuesFor: [...new Set(unknown)],
      projectedTotalIfCoursesCount: projectedTotal,
      remainingIfKnown:
        projectedTotal === null
          ? null
          : Math.max(0, degreeReq.rule.required - projectedTotal),
    };
  }

  const requirements: RequirementCoverageItem[] = audit.requirements.map(
    (req) => {
      const linked = planned.filter((c) => c.ids.has(req.id));
      const linkedIds = linked.map((c) => c.courseId);
      const base = {
        requirementId: req.id,
        section: req.section,
        ruleKind: req.rule.kind,
        supportingCourses: linkedIds,
      };
      const rule = req.rule;
      if (req.status === "complete") {
        return {
          ...base,
          status: "already_met" as const,
          explanation: "Marked complete in the source audit.",
        };
      }

      if (rule.kind === "required_course") {
        const id = normalize(rule.courseId);
        if (linkedIds.includes(id))
          return {
            ...base,
            status: "planned" as const,
            explanation: `${id} is included in the proposed plan (subject to completion and eligibility).`,
          };
        if (req.status === "in_progress" || inProgress.has(id))
          return {
            ...base,
            status: "conditional_ip" as const,
            explanation: `${id} is in progress; completion is not guaranteed.`,
          };
        if (completed.has(id))
          return {
            ...base,
            status: "unverified" as const,
            explanation: `${id} appears completed, but the extracted requirement is not marked complete; reconcile the audit.`,
          };
        return {
          ...base,
          status: "missing" as const,
          explanation: `Required course ${id} is not scheduled.`,
          missingCourseSlots: 1,
        };
      }

      if (rule.kind === "choose_courses" || rule.kind === "course_range") {
        const matching = linked.filter((c) =>
          rule.kind === "choose_courses"
            ? rule.options.some((opt) => normalize(opt) === c.courseId)
            : matchesRange(
                c.courseId,
                rule.subject,
                rule.minNumber,
                rule.maxNumber,
              ),
        );
        // A single course claimed for two different course slots needs human policy review.
        const eligible = matching.filter(
          (c) =>
            [...c.ids].filter((id) => {
              const r = audit.requirements.find((x) => x.id === id)?.rule;
              return (
                r &&
                ["required_course", "choose_courses", "course_range"].includes(
                  r.kind,
                )
              );
            }).length <= 1,
        );
        const count = new Set(eligible.map((c) => c.courseId)).size;
        if (count < rule.count) {
          return {
            ...base,
            status: "missing" as const,
            explanation: `${rule.count - count} additional course(s) needed for this choice/range requirement.`,
            missingCourseSlots: rule.count - count,
          };
        }
        if (matching.length > eligible.length || rule.kind === "course_range") {
          return {
            ...base,
            status: "unverified" as const,
            explanation:
              "Enough candidates were selected, but course-range eligibility or slot sharing needs review.",
          };
        }
        return {
          ...base,
          status: "planned" as const,
          explanation: `All ${rule.count} remaining choice slot(s) have proposed course(s).`,
        };
      }

      if (rule.kind === "credit_minimum") {
        const shortfall = Math.max(0, rule.required - (rule.applied ?? 0));
        if (rule.applied === null)
          return {
            ...base,
            status: "unverified" as const,
            explanation: "The original applied-credit amount is unknown.",
            projectedRemainingCredits: null,
          };
        if (shortfall === 0)
          return {
            ...base,
            status:
              req.status === "in_progress"
                ? ("conditional_ip" as const)
                : ("already_met" as const),
            explanation:
              "Audit shows the credit minimum met, possibly using in-progress credits.",
            projectedRemainingCredits: 0,
          };
        if (degreeCredits && degreeCredits.requirementId === req.id) {
          if (degreeCredits.remainingIfKnown === null)
            return {
              ...base,
              status: "unverified" as const,
              explanation: `Need ${shortfall} credits according to the audit; some proposed course credit values are unknown.`,
              projectedRemainingCredits: null,
            };
          const gap = degreeCredits.remainingIfKnown;
          if (gap > 0)
            return {
              ...base,
              status: "missing" as const,
              explanation: `Projected degree credit shortfall: ${gap} credit(s), assuming all proposals count.`,
              projectedRemainingCredits: gap,
            };
          return {
            ...base,
            status: "planned" as const,
            explanation:
              "Proposed credits may reach this total, conditional on eligibility and passing grades.",
            projectedRemainingCredits: 0,
          };
        }
        // Category credits cannot be allocated generically: an individual course may
        // contribute to several counters and some categories restrict sharing.
        return {
          ...base,
          status: "unverified" as const,
          explanation: `${shortfall} credit(s) remain in this category; proposed courses need category-specific allocation.`,
          projectedRemainingCredits: null,
        };
      }

      // complex requirements: interpreted by LLM, NOT deterministically verified.
      if (req.status === "in_progress")
        return {
          ...base,
          status: "conditional_ip" as const,
          explanation:
            "Audit says in progress; passing and any remaining conditions are unverified.",
        };
      if (linked.length)
        return {
          ...base,
          status: "unverified" as const,
          explanation:
            "The plan references this complex rule, but its actual satisfaction is not verified.",
        };
      return {
        ...base,
        status: "missing" as const,
        explanation:
          "Outstanding complex requirement is not accounted for by a proposed course or verified completion.",
      };
    },
  );

  const missing = requirements.filter((r) => r.status === "missing");
  const uncertain = requirements.filter(
    (r) => r.status === "unverified" || r.status === "conditional_ip",
  );
  return {
    requirements,
    degreeCredits,
    missing,
    uncertain,
    extractedRequirementCount: audit.requirements.length,
    assessedRequirementCount: requirements.length,
    allExtractedRequirementsConditionallyCovered:
      requirements.length > 0 &&
      missing.length === 0 &&
      uncertain.length === 0 &&
      audit.unresolved.length === 0,
    unresolvedAuditNotes: audit.unresolved.length,
    canCertifyGraduation: false,
  };
}
