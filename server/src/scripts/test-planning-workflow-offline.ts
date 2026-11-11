import assert from "node:assert/strict";
import type { AcademicAudit } from "../services/audit-schema.ts";
import type {
  AiPlan,
  PlanningPreferences,
} from "../services/ai-plan-schema.ts";
import { validateProposedPlan } from "../services/plan-validator.ts";
import {
  generateReviewedTwoYearPlan,
  type PlanningDependencies,
} from "../services/planning-workflow.ts";

const ev = { page: 1, quote: "still needed" };
const audit: AcademicAudit = {
  institution: "Example",
  program: "Bachelor of Science",
  auditDate: null,
  catalog: null,
  courses: [],
  policies: [],
  unresolved: [],
  requirements: [
    {
      id: "degree",
      section: "Degree in Bachelor",
      status: "still_needed",
      originalText: "120 credits required for degree",
      rule: {
        kind: "credit_minimum",
        required: 120,
        applied: 114,
        remaining: 6,
        eligibleCourseText: null,
      },
      evidence: ev,
    },
    {
      id: "core",
      section: "Major",
      status: "still_needed",
      originalText: "CISC 3140",
      rule: { kind: "required_course", courseId: "CISC 3140" },
      evidence: ev,
    },
    {
      id: "extra",
      section: "Major",
      status: "still_needed",
      originalText: "1 more CISC 3000-4899",
      rule: {
        kind: "course_range",
        count: 1,
        subject: "CISC",
        minNumber: 3000,
        maxNumber: 4899,
      },
      evidence: ev,
    },
  ],
};
const prefs: PlanningPreferences = {
  startTerm: { season: "Fall", year: 2027 },
  maxCoursesPerSemester: 3,
  includeSummer: false,
  includeWinter: false,
};
const terms = [
  { season: "Fall" as const, year: 2027 },
  { season: "Spring" as const, year: 2028 },
  { season: "Fall" as const, year: 2028 },
  { season: "Spring" as const, year: 2029 },
];
const core = {
  courseId: "CISC 3140",
  requirementIds: ["core"],
  reason: "needed",
  prerequisiteNote: "unknown",
};
const extra = {
  courseId: "CISC 3667",
  requirementIds: ["extra"],
  reason: "range",
  prerequisiteNote: "unverified",
};
const make = (courses: Array<(typeof core)[]>): AiPlan => ({
  semesters: terms.map((t, i) => ({ ...t, courses: courses[i] ?? [] })),
  overview: "Provisional",
  limitations: ["Not verified"],
});
const draft = make([[core], [], [], []]);
const fix = make([[core, extra], [], [], []]);
const failed = make([[core, extra, extra], [], [], []]);
const knownCredits = new Map([
  ["CISC 3140", 3],
  ["CISC 3667", 4],
]);
const check = async (plan: AiPlan) => ({
  validation: validateProposedPlan(plan, audit, prefs, knownCredits, true),
  prerequisites: [] as [],
  missingDatabaseCreditValues: [] as string[],
});
let calls = 0;
const deps: PlanningDependencies = {
  generateInitial: async () => ({
    plan: draft,
    validation: validateProposedPlan(draft, audit, prefs),
    model: "test",
    tokenUsage: { input: 100, output: 50 },
  }),
  checkWithDb: check,
  candidates: async () => [
    {
      courseId: "CISC 3667",
      credits: 4,
      title: "Example",
      forRequirementId: "extra",
    },
  ],
  revise: async () => {
    calls++;
    return { plan: fix, model: "test", tokenUsage: { input: 80, output: 40 } };
  },
};
(async () => {
  const result = await generateReviewedTwoYearPlan(
    audit,
    {
      canDraftPlan: true,
      errors: [],
      warnings: [],
      limitations: [],
      requiresHumanReview: true,
    },
    prefs,
    deps,
  );
  assert.equal(calls, 1);
  assert.equal(result.revision.accepted, true);
  assert.equal(result.finalProposedTerm?.season, "Fall");
  assert.equal(result.graduationStatus, "needs_verification");
  assert.equal(
    result.validation.graduationCoverage.degreeCredits?.remainingIfKnown,
    0,
  );
  assert.equal(result.tokenUsage.input, 180);
  const unsafe = await generateReviewedTwoYearPlan(
    audit,
    {
      canDraftPlan: true,
      errors: [],
      warnings: [],
      limitations: [],
      requiresHumanReview: true,
    },
    prefs,
    {
      ...deps,
      revise: async () => ({
        plan: failed,
        model: "test",
        tokenUsage: { input: 30, output: 10 },
      }),
    },
  );
  assert.equal(unsafe.revision.accepted, false);
  assert.equal(unsafe.plan.semesters[0].courses.length, 1);
  console.log(
    "PASS: initial→DB checks→one AI revision→DB recheck→keep better/rollback unsafe; earlier finish",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
