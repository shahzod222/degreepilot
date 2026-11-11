import assert from "node:assert/strict";
import { validateAcademicAudit } from "../services/audit-validator.ts";
import type { AcademicAudit } from "../services/audit-schema.ts";

// Synthetic records only: this test has no personal information, PDF, or API call.
const evidence = { page: 1, quote: "Still needed" };
const base: AcademicAudit = {
  institution: "Example University",
  program: "BS in Example Studies",
  auditDate: "2026-11-02",
  catalog: null,
  courses: [
    {
      courseId: "CISC 1115",
      status: "completed",
      credits: 4,
      grade: "A",
      term: "SPRING 2026",
      evidence,
    },
    {
      courseId: "CISC 3130",
      status: "in_progress",
      credits: 4,
      grade: "IP",
      term: "SPRING 2027",
      evidence,
    },
    {
      courseId: "BUSN 2000",
      status: "not_allowed",
      credits: 3,
      grade: "B",
      term: "SPRING 2026",
      evidence,
    },
  ],
  requirements: [
    {
      id: "req-course",
      section: "Major",
      status: "still_needed",
      originalText: "Still needed: CISC 3140",
      rule: { kind: "required_course", courseId: "CISC 3140" },
      evidence,
    },
    {
      id: "req-choice",
      section: "Major",
      status: "still_needed",
      originalText: "Choose one",
      rule: {
        kind: "choose_courses",
        count: 1,
        options: ["CISC 3220", "CISC 3230"],
      },
      evidence,
    },
    {
      id: "degree-total",
      section: "Degree",
      status: "still_needed",
      originalText: "120 required, 98 applied, 22 remaining",
      rule: {
        kind: "credit_minimum",
        required: 120,
        applied: 98,
        remaining: 22,
        eligibleCourseText: null,
      },
      evidence,
    },
  ],
  policies: [],
  unresolved: [],
};

const validate = (
  audit: AcademicAudit,
  evidenceIssues: Array<{ item: string; page: number; problem: string }> = [],
) => validateAcademicAudit(audit, evidenceIssues);
const clone = (): AcademicAudit => structuredClone(base);

assert.equal(
  validate(clone()).canDraftPlan,
  true,
  "Valid extraction should permit a provisional plan",
);
assert.equal(validate(clone()).errors.length, 0);

{
  const audit = clone();
  audit.requirements[2].rule = {
    kind: "credit_minimum",
    required: 120,
    applied: 98,
    remaining: 21,
    eligibleCourseText: null,
  };
  assert(
    validate(audit).errors.some(
      (issue) => issue.code === "CREDIT_COUNTER_MISMATCH",
    ),
  );
}
{
  const audit = clone();
  audit.courses.push({ ...audit.courses[1] });
  assert(
    validate(audit).errors.some(
      (issue) => issue.code === "DUPLICATE_COURSE_RECORD",
    ),
  );
}
{
  const audit = clone();
  audit.courses.push({ ...audit.courses[1], status: "completed", grade: "A" });
  assert(
    validate(audit).errors.some(
      (issue) => issue.code === "COURSE_STATUS_CONFLICT",
    ),
  );
}
{
  const audit = clone();
  audit.requirements[1].rule = {
    kind: "choose_courses",
    count: 3,
    options: ["CISC 3220", "CISC 3230"],
  };
  assert(
    validate(audit).errors.some(
      (issue) => issue.code === "IMPOSSIBLE_CHOICE_COUNT",
    ),
  );
}
{
  const audit = clone();
  audit.requirements[1].rule = {
    kind: "course_range",
    count: 1,
    subject: "CISC",
    minNumber: 4899,
    maxNumber: 3000,
  };
  assert(
    validate(audit).errors.some(
      (issue) => issue.code === "INVALID_COURSE_RANGE",
    ),
  );
}
{
  const audit = clone();
  audit.requirements[1].rule = {
    kind: "complex",
    description: "An audit-specific residency exception",
  };
  assert.equal(validate(audit).canDraftPlan, true);
  assert(
    validate(audit).warnings.some(
      (issue) => issue.code === "UNSUPPORTED_REQUIREMENT",
    ),
  );
}
{
  const report = validate(clone(), [
    { item: "course:CISC 3130", page: 1, problem: "Quote not found on page" },
  ]);
  assert.equal(report.canDraftPlan, false);
  assert(report.errors.some((issue) => issue.code === "EVIDENCE_MISMATCH"));
}
{
  const audit = clone();
  audit.courses.push({
    ...audit.courses[1],
    term: "FALL 2027",
    status: "completed",
    grade: "A",
  });
  const report = validate(audit);
  assert.equal(
    report.errors.length,
    0,
    "Repeat courses across different terms are not automatically invalid",
  );
  assert(
    report.warnings.some((issue) => issue.code === "COURSE_REPEAT_REVIEW"),
  );
}

console.log("PASS: 9 offline validator scenarios (no OpenAI request)");
