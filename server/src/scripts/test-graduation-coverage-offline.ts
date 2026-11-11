import assert from "node:assert/strict";
import type { AcademicAudit } from "../services/audit-schema.ts";
import type {
  AiPlan,
  PlanningPreferences,
} from "../services/ai-plan-schema.ts";
import { validateProposedPlan } from "../services/plan-validator.ts";

const evidence = { page: 1, quote: "Still needed" };
const audit: AcademicAudit = {
  institution: "Test University",
  program: "Test B.S.",
  auditDate: null,
  catalog: null,
  courses: [
    {
      courseId: "CISC 1115",
      status: "completed",
      credits: 4,
      grade: "A",
      term: "2026",
      evidence,
    },
    {
      courseId: "CISC 3130",
      status: "in_progress",
      credits: 4,
      grade: "IP",
      term: "Spring 2027",
      evidence,
    },
  ],
  requirements: [
    {
      id: "degree-credit-min",
      section: "Degree in Bachelor of Science",
      status: "still_needed",
      originalText: "120 credits are required for your degree",
      rule: {
        kind: "credit_minimum",
        required: 120,
        applied: 98,
        remaining: 22,
        eligibleCourseText: null,
      },
      evidence,
    },
    {
      id: "core",
      section: "Major",
      status: "still_needed",
      originalText: "1 Course CISC 3140",
      rule: { kind: "required_course", courseId: "CISC 3140" },
      evidence,
    },
    {
      id: "advanced-elective",
      section: "Major",
      status: "still_needed",
      originalText: "1 course CISC 3000 through 4899",
      rule: {
        kind: "course_range",
        count: 1,
        subject: "CISC",
        minNumber: 3000,
        maxNumber: 4899,
      },
      evidence,
    },
    {
      id: "college-option",
      section: "College Option",
      status: "still_needed",
      originalText: "Choose one remaining category",
      rule: { kind: "complex", description: "Choose ICC or Science" },
      evidence,
    },
  ],
  policies: [],
  unresolved: [],
};
const prefs: PlanningPreferences = {
  startTerm: { year: 2027, season: "Fall" },
  maxCoursesPerSemester: 3,
  includeSummer: false,
  includeWinter: false,
};
const plan: AiPlan = {
  semesters: [
    {
      year: 2027,
      season: "Fall",
      courses: [
        {
          courseId: "CISC 3140",
          requirementIds: ["core"],
          reason: "required",
          prerequisiteNote: "verify",
        },
      ],
    },
    {
      year: 2028,
      season: "Spring",
      courses: [
        {
          courseId: "CISC 3142",
          requirementIds: ["degree-credit-min"],
          reason: "credit projection unverified",
          prerequisiteNote: "verify",
        },
      ],
    },
    {
      year: 2028,
      season: "Fall",
      courses: [
        {
          courseId: "CISC 3320",
          requirementIds: ["degree-credit-min"],
          reason: "credit projection unverified",
          prerequisiteNote: "verify",
        },
      ],
    },
    {
      year: 2029,
      season: "Spring",
      courses: [
        {
          courseId: "ANTH 1100",
          requirementIds: ["college-option"],
          reason: "possible option",
          prerequisiteNote: "verify",
        },
      ],
    },
  ],
  overview: "Test",
  limitations: ["Unverified"],
};
const map = new Map([
  ["CISC 3140", 6],
  ["CISC 3142", 6],
  ["CISC 3320", 6],
  ["ANTH 1100", 3],
]);
const r = validateProposedPlan(plan, audit, prefs, map);
assert.equal(
  r.graduationCoverage.degreeCredits?.projectedTotalIfCoursesCount,
  119,
);
assert.equal(r.graduationCoverage.degreeCredits?.remainingIfKnown, 1);
assert(
  r.graduationCoverage.missing.some(
    (x) => x.requirementId === "advanced-elective",
  ),
);
assert(
  r.graduationCoverage.uncertain.some(
    (x) => x.requirementId === "college-option",
  ),
);
assert.equal(
  r.graduationCoverage.allExtractedRequirementsConditionallyCovered,
  false,
);
assert.equal(r.graduationCoverage.canCertifyGraduation, false);
const unknown = validateProposedPlan(plan, audit, prefs);
assert.equal(unknown.graduationCoverage.degreeCredits?.remainingIfKnown, null);
assert.equal(
  unknown.graduationCoverage.degreeCredits?.missingCreditValuesFor.length,
  4,
);
assert.equal(
  unknown.graduationCoverage.missing.some(
    (x) => x.requirementId === "degree-credit-min",
  ),
  false,
);
console.log(
  "PASS: Graduation coverage detects missing elective, 1-credit gap, and unknown credit values (offline)",
);
