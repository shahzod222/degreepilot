import assert from "node:assert/strict";
import type { AcademicAudit } from "../services/audit-schema.ts";
import type {
  AiPlan,
  PlanningPreferences,
} from "../services/ai-plan-schema.ts";
import { validateProposedPlan } from "../services/plan-validator.ts";
import {
  actionablePlanFeedback,
  isRevisedPlanBetter,
  lastScheduledTermIndex,
} from "../services/plan-review.ts";

const evidence = { page: 1, quote: "Still needed" };
const audit: AcademicAudit = {
  institution: "Example University",
  program: "B.S.",
  auditDate: null,
  catalog: null,
  courses: [],
  policies: [],
  unresolved: [],
  requirements: [
    {
      id: "total",
      section: "Degree in Bachelor of Science",
      status: "still_needed",
      originalText: "120 credits are required for your degree",
      rule: {
        kind: "credit_minimum",
        required: 120,
        applied: 114,
        remaining: 6,
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
      id: "elective",
      section: "Major",
      status: "still_needed",
      originalText: "1 additional CISC 3000 through 4899",
      rule: {
        kind: "course_range",
        count: 1,
        subject: "CISC",
        minNumber: 3000,
        maxNumber: 4899,
      },
      evidence,
    },
  ],
};
const prefs: PlanningPreferences = {
  startTerm: { year: 2027, season: "Fall" },
  maxCoursesPerSemester: 3,
  includeSummer: false,
  includeWinter: false,
};
const terms = [
  { year: 2027, season: "Fall" as const },
  { year: 2028, season: "Spring" as const },
  { year: 2028, season: "Fall" as const },
  { year: 2029, season: "Spring" as const },
];
const core = {
  courseId: "CISC 3140",
  requirementIds: ["core"],
  reason: "Needed",
  prerequisiteNote: "Review",
};
const elective = {
  courseId: "CISC 3667",
  requirementIds: ["elective"],
  reason: "Matches range",
  prerequisiteNote: "Review",
};
const make = (distribution: Array<(typeof core)[]>): AiPlan => ({
  semesters: terms.map((term, i) => ({
    ...term,
    courses: distribution[i] ?? [],
  })),
  overview: "Provisional",
  limitations: ["Availability and category allocation require review."],
});
const original = make([[core], [], [], []]);
const improvedLate = make([[core], [], [elective], []]);
const improvedEarly = make([[core, elective], [], [], []]);
const credits = new Map([
  ["CISC 3140", 3],
  ["CISC 3667", 4],
]);
const origV = validateProposedPlan(original, audit, prefs, credits, true);
const lateV = validateProposedPlan(improvedLate, audit, prefs, credits, true);
const earlyV = validateProposedPlan(improvedEarly, audit, prefs, credits, true);
assert.equal(origV.graduationCoverage.missing.length, 2); // elective + credits
assert.equal(lateV.graduationCoverage.missing.length, 0);
assert(
  isRevisedPlanBetter(
    { plan: original, validation: origV },
    { plan: improvedLate, validation: lateV },
  ),
);
assert(
  isRevisedPlanBetter(
    { plan: improvedLate, validation: lateV },
    { plan: improvedEarly, validation: earlyV },
  ),
);
assert.equal(lastScheduledTermIndex(improvedEarly), 0);
const feedback = actionablePlanFeedback(original, origV, prefs);
assert(feedback.some((f) => f.requirementId === "elective"));
assert(feedback.some((f) => f.code === "DEGREE_CREDIT_SHORTFALL"));
const delayed = make([[], [], [core, elective], []]);
const delayFeedback = actionablePlanFeedback(delayed, earlyV, prefs);
assert(delayFeedback.some((f) => f.code === "POSSIBLY_DELAYED_SCHEDULE"));
const invalid = make([[core, elective, core], [], [], []]);
const invalidV = validateProposedPlan(invalid, audit, prefs, credits, true);
assert(invalidV.errors.length > 0);
assert(
  !isRevisedPlanBetter(
    { plan: improvedEarly, validation: earlyV },
    { plan: invalid, validation: invalidV },
  ),
);
{
  const shortfallAudit: AcademicAudit = structuredClone(audit);
  const total = shortfallAudit.requirements.find((r) => r.id === "total")!;
  if (total.rule.kind !== "credit_minimum") throw new Error("Expected credits");
  total.rule.applied = 110;
  total.rule.remaining = 10;
  const partial = validateProposedPlan(improvedEarly, shortfallAudit, prefs, credits, true);
  assert.equal(partial.graduationCoverage.degreeCredits?.remainingIfKnown, 3);
  const filler = {
    courseId: "CISC 3800",
    requirementIds: ["total"],
    reason: "Catalog-backed potential credits; eligibility unverified",
    prerequisiteNote: "Verify",
  };
  const full = make([[core, elective, filler], [], [], []]);
  const withFiller = validateProposedPlan(full, shortfallAudit, prefs, new Map([...credits, ["CISC 3800", 3]]), true, [
    { courseId: "CISC 3800", title: "Catalog elective", credits: 3, forRequirementId: "total" },
  ]);
  assert.equal(withFiller.errors.length, 0);
  assert.equal(withFiller.graduationCoverage.degreeCredits?.remainingIfKnown, 0);
  assert(isRevisedPlanBetter({ plan: improvedEarly, validation: partial }, { plan: full, validation: withFiller }));
}
console.log(
  "PASS: missing elective + credit gap, catalog-backed filler, earlier completion and invalid revision rejection",
);
