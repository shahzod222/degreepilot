import type { AcademicAudit } from "./audit-schema.ts";

/** A deterministic contract derived from the extracted audit, NOT an LLM conclusion. */
export type PlanningTargetAction =
  | "schedule" // An outstanding course slot to address
  | "credit_target" // A reported credit threshold, not a new course authorization
  | "conditional" // An in-progress requirement; don't schedule the same course twice
  | "review" // Rule/status cannot be proved from the extracted structure
  | "already_met";

export interface PlanningTarget {
  requirementId: string;
  section: string;
  ruleKind: AcademicAudit["requirements"][number]["rule"]["kind"];
  sourceStatus: AcademicAudit["requirements"][number]["status"];
  action: PlanningTargetAction;
  remainingCourseSlots: number | null;
  specifiedCourseIds: string[];
  courseRange: { subject: string; minNumber: number; maxNumber: number } | null;
  credits: {
    required: number;
    applied: number | null;
    remaining: number | null;
  } | null;
  note: string;
}

const norm = (id: string) =>
  id.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");

/** One item for EVERY extracted requirement; unknowns stay unknown. */
export function buildPlanningChecklist(audit: AcademicAudit): PlanningTarget[] {
  const already = new Set(
    audit.courses
      .filter((c) => c.status === "completed" || c.status === "in_progress")
      .map((c) => norm(c.courseId)),
  );

  return audit.requirements.map((req) => {
    const rule = req.rule;
    const base = {
      requirementId: req.id,
      section: req.section,
      ruleKind: rule.kind,
      sourceStatus: req.status,
      remainingCourseSlots: null as number | null,
      specifiedCourseIds: [] as string[],
      courseRange: null as PlanningTarget["courseRange"],
      credits: null as PlanningTarget["credits"],
    };

    if (req.status === "complete") {
      return {
        ...base,
        action: "already_met" as const,
        note: "Marked complete in the audit; do not add courses for it.",
      };
    }
    if (rule.kind === "required_course") {
      const id = norm(rule.courseId);
      if (already.has(id) || req.status === "in_progress") {
        return {
          ...base,
          action: "conditional" as const,
          specifiedCourseIds: [id],
          note: "Course is already completed or in progress; do not reschedule; reconcile status if necessary.",
        };
      }
      if (req.status === "unknown") {
        return {
          ...base,
          action: "review" as const,
          specifiedCourseIds: [id],
          note: "Requirement status unknown; do not assume a new enrollment is needed.",
        };
      }
      return {
        ...base,
        action: "schedule" as const,
        remainingCourseSlots: 1,
        specifiedCourseIds: [id],
        note: "Mandatory course explicitly named by the audit.",
      };
    }
    if (rule.kind === "choose_courses" || rule.kind === "course_range") {
      const options =
        rule.kind === "choose_courses" ? rule.options.map(norm) : [];
      const range =
        rule.kind === "course_range"
          ? {
              subject: norm(rule.subject),
              minNumber: rule.minNumber,
              maxNumber: rule.maxNumber,
            }
          : null;
      if (req.status === "in_progress" || req.status === "unknown") {
        return {
          ...base,
          action:
            req.status === "in_progress"
              ? ("conditional" as const)
              : ("review" as const),
          specifiedCourseIds: options,
          courseRange: range,
          note: "Status is conditional or unknown. Check the audit before adding remaining slots.",
        };
      }
      return {
        ...base,
        action: "schedule" as const,
        remainingCourseSlots: rule.count,
        specifiedCourseIds: options,
        courseRange: range,
        note: "These are REMAINING distinct slots; a separate core course cannot automatically fill this slot.",
      };
    }
    if (rule.kind === "credit_minimum") {
      const remaining =
        rule.remaining ??
        (rule.applied === null
          ? null
          : Math.max(0, rule.required - rule.applied));
      return {
        ...base,
        action:
          req.status === "in_progress"
            ? ("conditional" as const)
            : remaining === 0
              ? ("already_met" as const)
              : ("credit_target" as const),
        credits: { required: rule.required, applied: rule.applied, remaining },
        note: "Credit counters may overlap. In-progress credits may already be applied. This is NOT permission to add an arbitrary elective.",
      };
    }
    return {
      ...base,
      action:
        req.status === "in_progress"
          ? ("conditional" as const)
          : ("review" as const),
      note: "Complex requirement: preserve the uncertainty; don't mark it satisfied without evidence.",
    };
  });
}

/** Quick deterministic sanity checks before selecting any plan as complete. */
export function checklistSummary(targets: PlanningTarget[]) {
  return {
    extractedRequirements: targets.length,
    explicitCourseSlots: targets
      .filter((t) => t.action === "schedule")
      .reduce((sum, t) => sum + (t.remainingCourseSlots ?? 0), 0),
    creditTargets: targets
      .filter((t) => t.action === "credit_target")
      .map((t) => t.requirementId),
    reviewRequired: targets
      .filter((t) => t.action === "review")
      .map((t) => t.requirementId),
    conditional: targets
      .filter((t) => t.action === "conditional")
      .map((t) => t.requirementId),
  };
}
