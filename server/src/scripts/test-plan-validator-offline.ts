import assert from "node:assert/strict";
import type { AcademicAudit } from "../services/audit-schema.ts";
import {
  type AiPlan,
  type PlanningPreferences,
} from "../services/ai-plan-schema.ts";
import { validateProposedPlan } from "../services/plan-validator.ts";

const e = { page: 1, quote: "Still needed" };
const audit: AcademicAudit = {
  institution: "Example College",
  program: "BS Example",
  auditDate: null,
  catalog: null,
  courses: [
    {
      courseId: "CISC 1115",
      status: "completed",
      credits: 4,
      grade: "A",
      term: "SPRING 2026",
      evidence: e,
    },
    {
      courseId: "CISC 3130",
      status: "in_progress",
      credits: 4,
      grade: "IP",
      term: "SPRING 2027",
      evidence: e,
    },
  ],
  requirements: [
    {
      id: "req",
      section: "Major",
      status: "still_needed",
      originalText: "CISC 3140",
      rule: { kind: "required_course", courseId: "CISC 3140" },
      evidence: e,
    },
    {
      id: "choice",
      section: "Major",
      status: "still_needed",
      originalText: "CISC 3220 or 3230",
      rule: {
        kind: "choose_courses",
        count: 1,
        options: ["CISC 3220", "CISC 3230"],
      },
      evidence: e,
    },
    {
      id: "range",
      section: "Major",
      status: "still_needed",
      originalText: "CISC 3000 through 4899",
      rule: {
        kind: "course_range",
        count: 1,
        subject: "CISC",
        minNumber: 3000,
        maxNumber: 4899,
      },
      evidence: e,
    },
    {
      id: "other",
      section: "College option",
      status: "still_needed",
      originalText: "Choose one of listed categories",
      rule: { kind: "complex", description: "Choose a category" },
      evidence: e,
    },
  ],
  policies: [],
  unresolved: [],
};
const prefs: PlanningPreferences = {
  startTerm: { year: 2027, season: "Fall" },
  maxCoursesPerSemester: 2,
  includeWinter: false,
  includeSummer: false,
};
const base: AiPlan = {
  semesters: [
    {
      year: 2027,
      season: "Fall",
      courses: [
        {
          courseId: "CISC 3140",
          requirementIds: ["req"],
          reason: "Required",
          prerequisiteNote: "To verify",
        },
      ],
    },
    {
      year: 2028,
      season: "Spring",
      courses: [
        {
          courseId: "CISC 3220",
          requirementIds: ["choice"],
          reason: "Choice",
          prerequisiteNote: "To verify",
        },
      ],
    },
    { year: 2028, season: "Fall", courses: [] },
    { year: 2029, season: "Spring", courses: [] },
  ],
  overview: "Draft for two years",
  limitations: ["Requires prerequisite verification"],
};
const clone = (): AiPlan => structuredClone(base);
const validate = (p: AiPlan) => validateProposedPlan(p, audit, prefs);
const has = (p: AiPlan, code: string) =>
  validate(p).errors.some((x) => x.code === code);
assert.equal(validate(clone()).canDisplayProvisionalPlan, true);
{
  const p = clone();
  p.semesters[0].courses.push({
    courseId: "CISC 3130",
    requirementIds: ["req"],
    reason: "",
    prerequisiteNote: "",
  });
  assert(has(p, "ALREADY_COMPLETED_OR_IN_PROGRESS"));
}
{
  const p = clone();
  p.semesters[1].courses.push({
    courseId: "CISC 3140",
    requirementIds: ["req"],
    reason: "",
    prerequisiteNote: "",
  });
  assert(has(p, "DUPLICATE_PLACEMENT"));
}
{
  const p = clone();
  p.semesters[0].courses.push(
    {
      courseId: "CISC 3220",
      requirementIds: ["choice"],
      reason: "",
      prerequisiteNote: "",
    },
    {
      courseId: "CISC 3230",
      requirementIds: ["choice"],
      reason: "",
      prerequisiteNote: "",
    },
  );
  assert(has(p, "COURSE_LIMIT"));
  assert(has(p, "EXCESS_CHOICE_COURSES"));
}
{
  const p = clone();
  p.semesters[0].year = 2030;
  assert(has(p, "TERM_OUTSIDE_HORIZON"));
}
{
  const p = clone();
  p.semesters[1].season = "Summer";
  assert(has(p, "TERM_OUTSIDE_HORIZON"));
}
{
  const p = clone();
  p.semesters[0].courses[0].requirementIds = ["made-up"];
  assert(has(p, "UNKNOWN_REQUIREMENT_ID"));
}
{
  const p = clone();
  p.semesters[0].courses[0].courseId = "CISC 8888";
  assert(has(p, "WRONG_REQUIRED_COURSE"));
}
{
  const p = clone();
  p.semesters[0].courses[0] = {
    courseId: "CISC 3100",
    requirementIds: ["range"],
    reason: "",
    prerequisiteNote: "",
  };
  assert(
    validate(p).warnings.some((x) => x.code === "COURSE_RANGE_UNVERIFIED"),
  );
}
{
  const p = clone();
  p.semesters[0].courses[0] = {
    courseId: "ANTH 1100",
    requirementIds: ["other"],
    reason: "",
    prerequisiteNote: "",
  };
  assert(
    validate(p).warnings.some((x) => x.code === "UNVERIFIED_REQUIREMENT_MATCH"),
  );
}
// Model instructions cannot bypass semester-specific caps.
{
  const seasonalPrefs: PlanningPreferences = {
    ...prefs,
    startTerm: { season: "Summer", year: 2027 },
    maxCoursesPerSemester: 5,
    includeSummer: true,
    includeWinter: true,
  };
  const seasons: AiPlan = {
    ...base,
    semesters: [
      { season: "Summer", year: 2027, courses: [] },
      { season: "Fall", year: 2027, courses: [] },
      { season: "Winter", year: 2028, courses: [] },
      { season: "Spring", year: 2028, courses: [] },
      { season: "Summer", year: 2028, courses: [] },
      { season: "Fall", year: 2028, courses: [] },
      { season: "Winter", year: 2029, courses: [] },
      { season: "Spring", year: 2029, courses: [] },
    ],
  };
  const code = (id: string) => ({ courseId: id, requirementIds: ["req"], reason: "Test", prerequisiteNote: "Test" });
  seasons.semesters[0].courses = [code("CISC 3140"), code("CISC 3142"), code("CISC 3320")];
  assert(validateProposedPlan(seasons, audit, seasonalPrefs).errors.some((e) => e.code === "COURSE_LIMIT"));
  seasons.semesters[0].courses.pop();
  seasons.semesters[2].courses = [code("CISC 3140"), code("CISC 3142"), code("CISC 3320")];
  assert(validateProposedPlan(seasons, audit, seasonalPrefs).errors.some((e) => e.code === "COURSE_LIMIT"));
  seasons.semesters[2].courses = [];
  seasons.semesters[1].courses = Array.from({length: 5}, (_, n) => code(`TEST ${n}`));
  assert(!validateProposedPlan(seasons, audit, seasonalPrefs).errors.some((e) => e.code === "COURSE_LIMIT"));
  seasons.semesters[1].courses.push(code("TEST 5"));
  assert(validateProposedPlan(seasons, audit, seasonalPrefs).errors.some((e) => e.code === "COURSE_LIMIT"));
}
console.log("PASS: original validator scenarios + seasonal max-2/max-5 caps (no OpenAI request)");
{
  const p = clone();
  p.semesters[0].courses[0] = {
    courseId: "CISC 9999",
    requirementIds: ["other"],
    reason: "",
    prerequisiteNote: "",
  };
  assert(has(p, "UNSUPPORTED_COURSE"));
}
