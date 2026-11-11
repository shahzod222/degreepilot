import type { AcademicAudit } from "./audit-schema.ts";
import type { EvidenceIssue } from "./audit-extraction.ts";

export type IssueSeverity = "error" | "warning";

export interface AuditValidationIssue {
  severity: IssueSeverity;
  code: string;
  path: string;
  message: string;
}

export interface AuditValidationReport {
  // Can we safely use this extraction as input for a PROVISIONAL planning draft?
  // This does NOT certify graduation eligibility or prerequisite satisfaction.
  canDraftPlan: boolean;
  errors: AuditValidationIssue[];
  warnings: AuditValidationIssue[];
  limitations: string[];
  requiresHumanReview: true;
}

/** Format normalization for comparing course IDs. This is NOT equivalency matching. */
function normalizeCourseId(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s*\.\s*/g, " ")
    .replace(/\s+/g, " ");
}

const normalizeTerm = (value: string | null): string =>
  (value ?? "").normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Validate only universal, checkable properties of an extracted academic audit.
 * No institution-specific curricular rules, prerequisite guesses, or degree
 * requirement overlap arithmetic live here.
 */
export function validateAcademicAudit(
  audit: AcademicAudit,
  evidenceIssues: EvidenceIssue[],
): AuditValidationReport {
  const errors: AuditValidationIssue[] = [];
  const warnings: AuditValidationIssue[] = [];

  function add(
    severity: IssueSeverity,
    code: string,
    path: string,
    message: string,
  ) {
    (severity === "error" ? errors : warnings).push({
      severity,
      code,
      path,
      message,
    });
  }

  // 1) Evidence quotes and page references are mechanical checks, not semantic proof.
  for (const issue of evidenceIssues) {
    add(
      "error",
      "EVIDENCE_MISMATCH",
      issue.item,
      `Page ${issue.page}: ${issue.problem}`,
    );
  }

  // 2) Course rows: deduplicate exact records; don't assume repeat courses are invalid.
  const courseRecords = new Map<string, number>();
  const byCourseAndTerm = new Map<string, Set<string>>();
  const courseStatuses = new Map<string, Set<string>>();

  audit.courses.forEach((course, index) => {
    const id = normalizeCourseId(course.courseId);
    const term = normalizeTerm(course.term);
    const path = `courses[${index}]`;
    const recordKey = JSON.stringify([id, term, course.status]);
    const sameTermKey = JSON.stringify([id, term]);

    if (courseRecords.has(recordKey)) {
      add(
        "error",
        "DUPLICATE_COURSE_RECORD",
        path,
        `Repeated ${id} record with identical status and term (first at index ${courseRecords.get(recordKey)}).`,
      );
    } else {
      courseRecords.set(recordKey, index);
    }

    const termStatuses = byCourseAndTerm.get(sameTermKey) ?? new Set<string>();
    termStatuses.add(course.status);
    byCourseAndTerm.set(sameTermKey, termStatuses);

    const statuses = courseStatuses.get(id) ?? new Set<string>();
    statuses.add(course.status);
    courseStatuses.set(id, statuses);

    if (
      course.grade?.trim().toUpperCase() === "IP" &&
      course.status !== "in_progress"
    ) {
      add(
        "error",
        "IP_GRADE_STATUS_CONFLICT",
        path,
        `${id} has grade IP but status ${course.status}.`,
      );
    }
    if (
      course.status === "in_progress" &&
      course.grade !== null &&
      course.grade.trim().toUpperCase() !== "IP"
    ) {
      add(
        "warning",
        "IN_PROGRESS_GRADE_REVIEW",
        path,
        `${id} is in progress but has grade '${course.grade}'; verify the audit row.`,
      );
    }
    if (course.status === "in_progress" && !term) {
      add(
        "warning",
        "MISSING_IN_PROGRESS_TERM",
        path,
        `${id} is in progress, but its academic term is unknown.`,
      );
    }
  });

  for (const [key, statuses] of byCourseAndTerm) {
    // 'not_allowed' can legitimately describe a completed transfer course excluded
    // from the degree. We must NOT interpret this label as a course prohibition.
    if (statuses.has("completed") && statuses.has("in_progress")) {
      const [id, term] = JSON.parse(key) as [string, string];
      add(
        "error",
        "COURSE_STATUS_CONFLICT",
        `course:${id}`,
        `${id} is listed as both completed and in progress in term '${term || "unspecified"}'.`,
      );
    }
  }

  for (const [id, statuses] of courseStatuses) {
    if (statuses.has("completed") && statuses.has("in_progress")) {
      add(
        "warning",
        "COURSE_REPEAT_REVIEW",
        `course:${id}`,
        `${id} appears as both completed and in progress. If these are different terms, this may be a legitimate repeat.`,
      );
    }
  }

  // 3) Generic course-choice rules and numerical consistency.
  audit.requirements.forEach((requirement, index) => {
    const { rule } = requirement;
    const path = `requirements[${index}]:${requirement.id}`;

    if (rule.kind === "choose_courses") {
      const options = rule.options.map(normalizeCourseId);
      const distinct = new Set(options);
      if (distinct.size !== options.length) {
        add(
          "warning",
          "DUPLICATE_CHOICE_OPTION",
          path,
          "A choice requirement repeats the same course ID.",
        );
      }
      if (rule.count > distinct.size) {
        add(
          "error",
          "IMPOSSIBLE_CHOICE_COUNT",
          path,
          `Choose ${rule.count}, but only ${distinct.size} distinct course options were extracted.`,
        );
      }
    }

    if (rule.kind === "course_range" && rule.minNumber > rule.maxNumber) {
      add(
        "error",
        "INVALID_COURSE_RANGE",
        path,
        `Course-number range ${rule.minNumber}–${rule.maxNumber} is reversed.`,
      );
    }

    if (
      rule.kind === "credit_minimum" &&
      rule.applied !== null &&
      rule.remaining !== null
    ) {
      // Counts may exceed a minimum: remaining then must be zero, not negative.
      const expectedRemaining = Math.max(0, rule.required - rule.applied);
      if (Math.abs(expectedRemaining - rule.remaining) > 0.01) {
        add(
          "error",
          "CREDIT_COUNTER_MISMATCH",
          path,
          `Required ${rule.required}, applied ${rule.applied}, remaining ${rule.remaining}; expected ${expectedRemaining}.`,
        );
      }
    }

    if (rule.kind === "complex") {
      add(
        "warning",
        "UNSUPPORTED_REQUIREMENT",
        path,
        "This rule needs LLM interpretation or human review before it can be evaluated by the current backend.",
      );
    }

    if (requirement.status === "unknown") {
      add(
        "warning",
        "UNKNOWN_REQUIREMENT_STATUS",
        path,
        "Requirement status was not established from the audit.",
      );
    }
  });

  if (!audit.requirements.length) {
    add(
      "error",
      "NO_REQUIREMENTS",
      "requirements",
      "No academic requirements were extracted; planning would be ungrounded.",
    );
  }

  if (!audit.courses.length) {
    add(
      "warning",
      "NO_COURSE_HISTORY",
      "courses",
      "No course records were extracted; prerequisite checks may be impossible.",
    );
  }

  if (audit.unresolved.length) {
    add(
      "warning",
      "UNRESOLVED_AUDIT_ITEMS",
      "unresolved",
      `${audit.unresolved.length} unresolved issue(s) were identified during extraction.`,
    );
  }

  return {
    canDraftPlan: errors.length === 0,
    errors,
    warnings,
    limitations: [
      "Evidence quote matches do not prove that the requirement was interpreted correctly or that no requirements were omitted.",
      "Do not add credit shortfalls from overlapping audit blocks or sum extracted course credits to reconstruct the degree total.",
      "In-progress courses and credits are not earned credits; future completion must remain conditional.",
      "A provisional draft is not an official graduation or registration eligibility determination.",
    ],
    requiresHumanReview: true,
  };
}
