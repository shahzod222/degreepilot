import type { AcademicAudit } from "./audit-schema.ts";
import type { CourseCandidate } from "./course-candidates.ts";
import {
  assessGraduationCoverage,
  type GraduationCoverageReport,
} from "./graduation-coverage.ts";
import {
  allowedTwoYearTerms,
  termCourseLimit,
  termKey,
  type AiPlan,
  type PlanningPreferences,
} from "./ai-plan-schema.ts";

export interface PlanIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}
export interface PlanValidationReport {
  canDisplayProvisionalPlan: boolean;
  errors: PlanIssue[];
  warnings: PlanIssue[];
  requiresHumanReview: true;
  /** Coverage is distinct from structural plan validity. */
  graduationCoverage: GraduationCoverageReport;
}

const normalize = (s: string): string =>
  s
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s*\.\s*/g, " ")
    .replace(/\s+/g, " ");

function matchesRange(
  courseId: string,
  subject: string,
  min: number,
  max: number,
): boolean {
  const match = /^([A-Z&]+)\s+(\d{1,4})(?:[A-Z])?$/.exec(courseId);
  return Boolean(
    match &&
    match[1] === normalize(subject) &&
    Number(match[2]) >= min &&
    Number(match[2]) <= max,
  );
}

/**
 * Generic and deterministic checks only. These cannot prove college eligibility,
 * prerequisite satisfaction, course availability, future earned credits, or graduation.
 * Complex audit text is never silently converted into a verified rule.
 */
export function validateProposedPlan(
  plan: AiPlan,
  audit: AcademicAudit,
  prefs: PlanningPreferences,
  knownCredits: ReadonlyMap<string, number> = new Map(),
  prerequisitesChecked = false,
  catalogCandidates: readonly CourseCandidate[] = [],
): PlanValidationReport {
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const add = (
    severity: "error" | "warning",
    code: string,
    path: string,
    message: string,
  ) => {
    (severity === "error" ? errors : warnings).push({
      severity,
      code,
      path,
      message,
    });
  };

  const expected = allowedTwoYearTerms(prefs).map(termKey);
  const expectedSet = new Set(expected);
  if (plan.semesters.length !== expected.length) {
    add(
      "error",
      "TERM_COUNT",
      "semesters",
      `Expected ${expected.length} permitted semesters, got ${plan.semesters.length}. Include empty semesters.`,
    );
  }

  const requirementById = new Map(audit.requirements.map((r) => [r.id, r]));
  const completedOrIp = new Set(
    audit.courses
      .filter((c) => c.status === "completed" || c.status === "in_progress")
      .map((c) => normalize(c.courseId)),
  );
  const excluded = new Set(
    audit.courses
      .filter((c) => c.status === "not_allowed")
      .map((c) => normalize(c.courseId)),
  );

  const scheduled = new Set<string>();
  const usedTerms = new Set<string>();
  const perChoiceCount = new Map<string, number>();

  for (const [index, semester] of plan.semesters.entries()) {
    const term = termKey(semester);
    const path = `semesters[${index}]`;
    if (!expectedSet.has(term)) {
      add(
        "error",
        "TERM_OUTSIDE_HORIZON",
        path,
        `${term} is not a permitted term in the two-year window.`,
      );
    }
    if (term !== expected[index]) {
      add(
        "error",
        "TERM_ORDER",
        path,
        `Expected ${expected[index] ?? "no term"}, got ${term}.`,
      );
    }
    if (usedTerms.has(term)) {
      add("error", "DUPLICATE_TERM", path, `${term} appears more than once.`);
    }
    usedTerms.add(term);
    const limit = termCourseLimit(semester, prefs);
    if (semester.courses.length > limit) {
      add(
        "error",
        "COURSE_LIMIT",
        path,
        `${semester.courses.length} courses exceed the ${semester.season} limit of ${limit}.`,
      );
    }

    for (const [j, proposed] of semester.courses.entries()) {
      const cp = `${path}.courses[${j}]`;
      const courseId = normalize(proposed.courseId);
      if (scheduled.has(courseId)) {
        add(
          "error",
          "DUPLICATE_PLACEMENT",
          cp,
          `${courseId} was already placed in another term.`,
        );
      }
      scheduled.add(courseId);
      if (completedOrIp.has(courseId)) {
        add(
          "error",
          "ALREADY_COMPLETED_OR_IN_PROGRESS",
          cp,
          `${courseId} is already shown as completed or in progress in the audit.`,
        );
      }
      if (excluded.has(courseId)) {
        add(
          "warning",
          "PREVIOUSLY_EXCLUDED",
          cp,
          `${courseId} appears under not-allowed electives. This is an excluded audit allocation, not necessarily a ban on enrolling again.`,
        );
      }
      const ids = new Set(proposed.requirementIds);
      if (ids.size !== proposed.requirementIds.length) {
        add(
          "warning",
          "DUPLICATE_REQUIREMENT_REFERENCE",
          cp,
          "Repeated requirement ID for the same course.",
        );
      }
      let hasExplicitCourseSupport = false;
      let hasUnverifiedSupport = false;
      let choiceSlots = 0;
      for (const reqId of ids) {
        const req = requirementById.get(reqId);
        if (!req) {
          add(
            "error",
            "UNKNOWN_REQUIREMENT_ID",
            cp,
            `Requirement '${reqId}' is not in the extracted audit.`,
          );
          continue;
        }
        if (req.status === "complete") {
          add(
            "warning",
            "REQUIREMENT_MARKED_COMPLETE",
            cp,
            `${reqId} is already marked complete in the audit.`,
          );
        } else if (req.status === "in_progress") {
          add(
            "warning",
            "REQUIREMENT_IN_PROGRESS",
            cp,
            `${reqId} is in progress. Verify whether an additional course is needed.`,
          );
        }
        const rule = req.rule;
        if (rule.kind === "required_course") {
          if (normalize(rule.courseId) === courseId) {
            hasExplicitCourseSupport = true;
          } else {
            add(
              "error",
              "WRONG_REQUIRED_COURSE",
              cp,
              `${courseId} does not match required course ${rule.courseId} for '${reqId}'.`,
            );
          }
        } else if (rule.kind === "choose_courses") {
          if (rule.options.some((opt) => normalize(opt) === courseId)) {
            hasExplicitCourseSupport = true;
            choiceSlots++;
            perChoiceCount.set(reqId, (perChoiceCount.get(reqId) ?? 0) + 1);
          } else {
            add(
              "error",
              "INVALID_CHOICE",
              cp,
              `${courseId} is not among extracted options for '${reqId}'.`,
            );
          }
        } else if (rule.kind === "course_range") {
          if (
            matchesRange(courseId, rule.subject, rule.minNumber, rule.maxNumber)
          ) {
            // A number-range match alone does not prove a real/eligible course exists.
            hasExplicitCourseSupport = true;
            hasUnverifiedSupport = true;
            choiceSlots++;
            perChoiceCount.set(reqId, (perChoiceCount.get(reqId) ?? 0) + 1);
            add(
              "warning",
              "COURSE_RANGE_UNVERIFIED",
              cp,
              `${courseId} matches the number range, but existence and eligibility are not verified.`,
            );
          } else {
            add(
              "error",
              "COURSE_OUTSIDE_RANGE",
              cp,
              `${courseId} does not fit extracted range for '${reqId}'.`,
            );
          }
        } else {
          // Complex/credit-only rules do not establish eligibility mechanically.
          // We will only accept a course supported SOLELY by one of these rules
          // if its complete ID is explicitly mentioned in the extracted rule text.
          // This prevents invented electives being justified by "120 credits needed".
          const sourceWords =
            rule.kind === "complex"
              ? `${req.originalText} ${rule.description}`
              : `${req.originalText} ${rule.eligibleCourseText ?? ""}`;
          if (
            normalize(sourceWords).includes(courseId) ||
            catalogCandidates.some(
              (candidate) =>
                candidate.forRequirementId === reqId &&
                normalize(candidate.courseId) === courseId,
            )
          )
            hasUnverifiedSupport = true;
          add(
            "warning",
            "UNVERIFIED_REQUIREMENT_MATCH",
            cp,
            `${reqId} is ${rule.kind}; eligibility for ${courseId} has not been confirmed.`,
          );
        }
      }
      if (choiceSlots > 1) {
        add(
          "warning",
          "POSSIBLE_DOUBLE_COUNT",
          cp,
          `${courseId} is linked to more than one course-choice slot. Audit sharing rules may not permit this.`,
        );
      }
      if (!hasExplicitCourseSupport && !hasUnverifiedSupport) {
        add(
          "error",
          "UNSUPPORTED_COURSE",
          cp,
          `${courseId} has no supporting course requirement in the extracted audit.`,
        );
      }
    }
  }

  for (const [reqId, count] of perChoiceCount) {
    const req = requirementById.get(reqId)!;
    const max =
      req.rule.kind === "choose_courses" || req.rule.kind === "course_range"
        ? req.rule.count
        : Infinity;
    if (count > max) {
      add(
        "error",
        "EXCESS_CHOICE_COURSES",
        `requirement:${reqId}`,
        `Scheduled ${count} courses for a requirement with ${max} remaining slot(s).`,
      );
    }
  }

  if (!plan.limitations.length) {
    add(
      "warning",
      "MISSING_LIMITATIONS",
      "limitations",
      "The recommendation omits limitations, although audit and prerequisite uncertainty remain.",
    );
  }
  if (!prerequisitesChecked) {
    add(
      "warning",
      "PREREQUISITES_NOT_VERIFIED",
      "plan",
      "PostgreSQL prerequisite checks have not been run for this plan.",
    );
  }
  add(
    "warning",
    "CREDIT_ALLOCATION_UNVERIFIED",
    "plan",
    "Even when a degree-credit projection is available, category eligibility, overlapping requirements, and future grades remain unverified.",
  );

  const graduationCoverage = assessGraduationCoverage(
    audit,
    plan,
    knownCredits,
  );
  for (const missing of graduationCoverage.missing) {
    add(
      "warning",
      "UNCOVERED_GRADUATION_REQUIREMENT",
      `requirement:${missing.requirementId}`,
      missing.explanation,
    );
  }
  for (const uncertain of graduationCoverage.uncertain) {
    add(
      "warning",
      "UNVERIFIED_GRADUATION_REQUIREMENT",
      `requirement:${uncertain.requirementId}`,
      uncertain.explanation,
    );
  }
  if (
    graduationCoverage.degreeCredits?.remainingIfKnown !== null &&
    graduationCoverage.degreeCredits?.remainingIfKnown !== undefined &&
    graduationCoverage.degreeCredits.remainingIfKnown > 0
  ) {
    add(
      "warning",
      "DEGREE_CREDIT_GAP",
      "degreeCredits",
      `${graduationCoverage.degreeCredits.remainingIfKnown} degree credit(s) still needed after the projected courses.`,
    );
  }

  return {
    canDisplayProvisionalPlan: errors.length === 0,
    errors,
    warnings,
    requiresHumanReview: true,
    graduationCoverage,
  };
}
