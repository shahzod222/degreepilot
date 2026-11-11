import { checkPrerequisites, getPrerequisites } from "./prerequisites.ts";
import { termCourseLimit } from "./ai-plan-schema.ts";
import {
  evaluateRequirements,
  normalizeCourses,
  type DegreeRequirement,
  type ChoiceGroup,
} from "./requirements.ts";

export type Season = "Winter" | "Spring" | "Summer" | "Fall";
export interface Term {
  year: number;
  season: Season;
}

export interface PlanInput {
  completedCourses: string[];
  requirements: DegreeRequirement[];
  maxCoursesPerSemester: number;
  includeSummer: boolean;
  includeWinter: boolean;
  startTerm: Term;
}

type CheckStatus = "satisfied" | "missing" | "needs_review" | "unknown";

export interface PlannedCourse {
  courseId: string;
  prerequisiteStatus: CheckStatus;
  tentative: boolean;
  reason?: string;
}
export interface PlannedSemester extends Term {
  courses: PlannedCourse[];
}
export interface GraduationPlan {
  semesters: PlannedSemester[];
  remainingRequiredCourses: string[];
  remainingChoiceGroups: ChoiceGroup[];
  /** All requirement slots from the supplied audit are covered by completed or planned courses. */
  allRequirementsScheduled: boolean;
  planningStatus: "all_requirements_scheduled" | "two_year_recommendation";
  estimated: true;
  warnings: string[];
  insights: string[];
}

interface SearchState {
  confirmed: Set<string>;
  assumed: Set<string>;
  semesters: PlannedSemester[];
}

const HORIZON_TERMS = 8; // Eight calendar terms = two years, starting at startTerm.
const BEAM_WIDTH = 10;
const CHOICE_POOL_LIMIT = 6; // Consider the six most promising ready courses in a term.
const CANDIDATE_LIMIT = 3; // Internal candidates; student sees one.

function nextTerm(term: Term): Term {
  switch (term.season) {
    case "Winter":
      return { year: term.year, season: "Spring" };
    case "Spring":
      return { year: term.year, season: "Summer" };
    case "Summer":
      return { year: term.year, season: "Fall" };
    case "Fall":
      return { year: term.year + 1, season: "Winter" };
  }
}

function permitted(term: Term, input: PlanInput): boolean {
  return (
    (term.season !== "Summer" || input.includeSummer) &&
    (term.season !== "Winter" || input.includeWinter)
  );
}

function twoYearTerms(input: PlanInput): Term[] {
  const terms: Term[] = [];
  let term = input.startTerm;
  for (let i = 0; i < HORIZON_TERMS; i++) {
    if (permitted(term, input)) terms.push(term);
    term = nextTerm(term);
  }
  return terms;
}

function combinations(
  items: PlannedCourse[],
  limit: number,
): PlannedCourse[][] {
  const output: PlannedCourse[][] = [];
  const chosen: PlannedCourse[] = [];
  function walk(start: number): void {
    if (chosen.length) output.push([...chosen]);
    if (chosen.length === limit) return;
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]);
      walk(i + 1);
      chosen.pop();
    }
  }
  walk(0);
  return output;
}

/**
 * One graph edge means: "this remaining course MAY help unlock that one".
 * It is a ranking HINT only; the actual checkPrerequisites() remains authoritative.
 * We also skip alternative prerequisite groups already met by completed courses.
 */
async function dependencyScores(
  remaining: string[],
  completed: Set<string>,
): Promise<Map<string, number>> {
  const remainingSet = new Set(remaining);
  const dependents = new Map(remaining.map((id) => [id, new Set<string>()]));

  function matchesLevel(
    id: string,
    subject: string | null,
    above: number | null,
  ): boolean {
    if (!subject || above === null) return false;
    const match = id.match(/^([A-Z]+)\s+(\d{4})$/);
    return (
      !!match && match[1] === subject.toUpperCase() && Number(match[2]) > above
    );
  }

  await Promise.all(
    remaining.map(async (target) => {
      const rows = await getPrerequisites(target);
      const groups = new Map<number, typeof rows>();
      for (const row of rows) {
        const options = groups.get(row.group_number) ?? [];
        options.push(row);
        groups.set(row.group_number, options);
      }

      for (const options of groups.values()) {
        // Already fulfilled by an original completed course: don't rank its alternatives.
        const fulfilled = options.some((option) => {
          if (option.requirement_type === "course") {
            return (
              !!option.required_course_id &&
              completed.has(option.required_course_id)
            );
          }
          if (option.requirement_type === "course_level") {
            return [...completed].some((id) =>
              matchesLevel(id, option.subject, option.course_number_above),
            );
          }
          return false;
        });
        if (fulfilled) continue;

        for (const option of options) {
          const possiblePrerequisites =
            option.requirement_type === "course"
              ? option.required_course_id
                ? [option.required_course_id]
                : []
              : option.requirement_type === "course_level"
                ? remaining.filter((id) =>
                    matchesLevel(
                      id,
                      option.subject,
                      option.course_number_above,
                    ),
                  )
                : [];
          for (const prereq of possiblePrerequisites) {
            if (remainingSet.has(prereq) && prereq !== target) {
              dependents.get(prereq)!.add(target);
            }
          }
        }
      }
    }),
  );

  const scores = new Map<string, number>();
  for (const courseId of remaining) {
    const visited = new Set([courseId]);
    let depth = 0;
    function follow(id: string, level: number): void {
      for (const next of dependents.get(id) ?? []) {
        if (visited.has(next)) continue; // Protect against cycles in imperfect data.
        visited.add(next);
        depth = Math.max(depth, level + 1);
        follow(next, level + 1);
      }
    }
    follow(courseId, 0);
    // Depth rewards prerequisite chains; reach rewards unlocking several courses.
    scores.set(courseId, depth * 10 + (visited.size - 1));
  }
  return scores;
}

function plannedCount(state: SearchState): number {
  return state.semesters.reduce((n, term) => n + term.courses.length, 0);
}
function tentativeCount(state: SearchState): number {
  return state.semesters.reduce(
    (n, term) => n + term.courses.filter((course) => course.tentative).length,
    0,
  );
}
function workloadSpread(semesters: PlannedSemester[]): number {
  // At the same total number of courses, smaller squares = more balanced loads.
  return semesters.reduce((total, term) => total + term.courses.length ** 2, 0);
}
function impactScore(
  state: SearchState,
  scores: Map<string, number>,
  totalTerms: number,
): number {
  return state.semesters.reduce(
    (total, term, termNo) =>
      total +
      term.courses.reduce(
        (sum, c) => sum + (scores.get(c.courseId) ?? 0) * (totalTerms - termNo),
        0,
      ),
    0,
  );
}
function projectedSpread(
  state: SearchState,
  remainingSlots: number,
  remainingTerms: number,
  limit: number,
): number {
  // An optimistic bound used only when comparing partial plans.
  const loads = state.semesters.map((t) => t.courses.length);
  const futureLoads = Array(remainingTerms).fill(0) as number[];
  const additional = Math.min(remainingSlots, remainingTerms * limit);
  for (let i = 0; i < additional; i++) {
    let smallest = 0;
    for (let j = 1; j < futureLoads.length; j++) {
      if (futureLoads[j] < futureLoads[smallest]) smallest = j;
    }
    if (futureLoads.length) futureLoads[smallest]++;
  }
  return [...loads, ...futureLoads].reduce((sum, n) => sum + n * n, 0);
}
function stateSignature(state: SearchState): string {
  return JSON.stringify(
    state.semesters.map((s) => [
      s.year,
      s.season,
      ...s.courses.map((c) => c.courseId).sort(),
    ]),
  );
}

function toPlan(
  state: SearchState,
  input: PlanInput,
  terms: Term[],
): GraduationPlan {
  const coverage = evaluateRequirements(input.requirements, [...state.assumed]);
  const scheduled = plannedCount(state);
  const tentative = tentativeCount(state);
  const remaining = coverage.totalSlots - coverage.fulfilledSlots;
  const warnings = [
    "Estimated two-year recommendation; course offerings, grades, credits, and official degree clearance are not verified.",
  ];
  if (tentative)
    warnings.push(
      `${tentative} course placement(s) have unknown or unconfirmed prerequisites.`,
    );
  if (remaining)
    warnings.push(
      `${remaining} requirement slot(s) remain beyond this window or are unresolved.`,
    );
  return {
    semesters: state.semesters,
    remainingRequiredCourses: coverage.requiredCourses,
    remainingChoiceGroups: coverage.choiceGroups,
    allRequirementsScheduled: remaining === 0,
    planningStatus:
      remaining === 0
        ? "all_requirements_scheduled"
        : "two_year_recommendation",
    estimated: true,
    warnings,
    insights: [
      `Recommended ${scheduled} course(s) over ${terms.length} permitted terms; ` +
        `${coverage.fulfilledSlots} of ${coverage.totalSlots} supplied requirement slot(s) covered including prior coursework.`,
      "Course choices are limited to outstanding mandatory requirements or eligible options in choice groups.",
      "Prerequisite chains across the full requirement pool influence earlier scheduling.",
      "The plan is an estimate, not an official graduation determination.",
    ],
  };
}

export async function generateCandidatePlans(
  input: PlanInput,
): Promise<GraduationPlan[]> {
  if (
    !Number.isInteger(input.maxCoursesPerSemester) ||
    input.maxCoursesPerSemester < 1 ||
    input.maxCoursesPerSemester > 5
  ) {
    throw new Error("maxCoursesPerSemester must be an integer between 1 and 5");
  }
  if (
    !Number.isInteger(input.startTerm.year) ||
    input.startTerm.year < 2000 ||
    !["Winter", "Spring", "Summer", "Fall"].includes(input.startTerm.season)
  ) {
    throw new Error("Invalid startTerm");
  }

  const originalCompleted = new Set(normalizeCourses(input.completedCourses));
  const initial = evaluateRequirements(input.requirements, [
    ...originalCompleted,
  ]);
  // Only courses drawn from the student's actual outstanding requirements.
  // Choice options are candidates, NOT 1-for-1 mandatory courses.
  const candidatePool = normalizeCourses([
    ...initial.requiredCourses,
    // Keep all options, even from already covered overlapping groups:
    // a new course can free another completed course to satisfy a different group.
    ...input.requirements.flatMap((req) =>
      req.type === "choose" ? req.options : [],
    ),
  ]).filter((id) => !originalCompleted.has(id));
  const terms = twoYearTerms(input);
  const scores = await dependencyScores(candidatePool, originalCompleted);

  // Per-request cache: same query behavior as before; no extra table or persistent store.
  const checkCache = new Map<string, Promise<CheckStatus>>();
  function check(
    courseId: string,
    completed: Set<string>,
  ): Promise<CheckStatus> {
    const key = `${courseId}|${[...completed].sort().join(",")}`;
    let answer = checkCache.get(key);
    if (!answer) {
      answer = checkPrerequisites(courseId, [...completed]).then(
        (result) => result.status as CheckStatus,
      );
      checkCache.set(key, answer);
    }
    return answer;
  }

  async function readyCourses(state: SearchState): Promise<PlannedCourse[]> {
    const ordered = candidatePool
      .filter((courseId) => !state.assumed.has(courseId))
      .sort(
        (a, b) =>
          (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b),
      );
    const ready: PlannedCourse[] = [];
    const covered = evaluateRequirements(input.requirements, [
      ...state.assumed,
    ]).fulfilledSlots;

    for (const courseId of ordered) {
      // Avoid unrelated courses and extra electives from already fulfilled choice groups.
      const withCourse = evaluateRequirements(input.requirements, [
        ...state.assumed,
        courseId,
      ]);
      if (withCourse.fulfilledSlots !== covered + 1) continue;

      const status = await check(courseId, state.confirmed);
      if (status === "satisfied") {
        ready.push({ courseId, prerequisiteStatus: status, tentative: false });
      } else if (status === "missing") {
        const withAssumptions = await check(courseId, state.assumed);
        if (withAssumptions === "missing") continue;
        ready.push({
          courseId,
          prerequisiteStatus: "needs_review",
          tentative: true,
          reason:
            "Depends on earlier tentative coursework or unresolved conditions",
        });
      } else {
        ready.push({
          courseId,
          prerequisiteStatus: status,
          tentative: true,
          reason:
            status === "unknown"
              ? "Prerequisite rules not stored"
              : "Requires review",
        });
      }
      if (ready.length === CHOICE_POOL_LIMIT) break;
    }
    return ready;
  }

  let frontier: SearchState[] = [
    {
      confirmed: new Set(originalCompleted),
      assumed: new Set(originalCompleted),
      semesters: [],
    },
  ];

  for (let step = 0; step < terms.length; step++) {
    const expanded: SearchState[] = [];
    const term = terms[step];
    for (const state of frontier) {
      const ready = await readyCourses(state);
      // Include an empty selection: sometimes deferring a flexible course
      // gives a better balance without losing progress inside two years.
      const choices = [[], ...combinations(ready, termCourseLimit(term, input))];
      const before = evaluateRequirements(input.requirements, [
        ...state.assumed,
      ]).fulfilledSlots;
      for (const selected of choices) {
        // Prevent counting the same course for two separate choice requirements.
        const after = evaluateRequirements(input.requirements, [
          ...state.assumed,
          ...selected.map((course) => course.courseId),
        ]).fulfilledSlots;
        if (after !== before + selected.length) continue;
        const confirmed = new Set(state.confirmed);
        const assumed = new Set(state.assumed);
        // Only count this term's courses AFTER the semester is fully selected.
        for (const course of selected) {
          assumed.add(course.courseId);
          if (!course.tentative) confirmed.add(course.courseId);
        }
        expanded.push({
          confirmed,
          assumed,
          semesters: [...state.semesters, { ...term, courses: selected }],
        });
      }
    }

    const remainingTerms = terms.length - step - 1;
    const remainingCapacity = terms
      .slice(step + 1)
      .reduce((count, next) => count + termCourseLimit(next, input), 0);
    function comparePartial(a: SearchState, b: SearchState): number {
      const potential = (s: SearchState) => {
        const cov = evaluateRequirements(input.requirements, [...s.assumed]);
        const openSlots = cov.totalSlots - cov.fulfilledSlots;
        return (
          cov.fulfilledSlots +
          Math.min(openSlots, remainingCapacity)
        );
      };
      const coverage = potential(b) - potential(a);
      if (coverage) return coverage;
      const impact =
        impactScore(b, scores, terms.length) -
        impactScore(a, scores, terms.length);
      if (impact) return impact;
      const openA = evaluateRequirements(input.requirements, [...a.assumed]);
      const openB = evaluateRequirements(input.requirements, [...b.assumed]);
      const balance =
        projectedSpread(
          a,
          openA.totalSlots - openA.fulfilledSlots,
          remainingTerms,
          input.maxCoursesPerSemester,
        ) -
        projectedSpread(
          b,
          openB.totalSlots - openB.fulfilledSlots,
          remainingTerms,
          input.maxCoursesPerSemester,
        );
      if (balance) return balance;
      const risk = tentativeCount(a) - tentativeCount(b);
      if (risk) return risk;
      return stateSignature(a).localeCompare(stateSignature(b));
    }

    // Keep at most ten unique partial schedules (beam search).
    expanded.sort(comparePartial);
    const seen = new Set<string>();
    frontier = expanded
      .filter((s) => {
        const key = stateSignature(s);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, BEAM_WIDTH);
  }

  const placed = (state: SearchState) => plannedCount(state);
  function compareFinal(a: SearchState, b: SearchState): number {
    const count = placed(b) - placed(a);
    if (count) return count;
    const impact =
      impactScore(b, scores, terms.length) -
      impactScore(a, scores, terms.length);
    if (impact) return impact;
    const risk = tentativeCount(a) - tentativeCount(b);
    if (risk) return risk;
    const spread = workloadSpread(a.semesters) - workloadSpread(b.semesters);
    if (spread) return spread;
    return stateSignature(a).localeCompare(stateSignature(b));
  }
  frontier.sort(compareFinal);
  const unique: GraduationPlan[] = [];
  const seen = new Set<string>();
  for (const state of frontier) {
    const key = stateSignature(state);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(toPlan(state, input, terms));
    if (unique.length === CANDIDATE_LIMIT) break;
  }
  return unique;
}

/** Student-facing API: returns one recommended two-year plan. */
export async function generateGraduationPlan(
  input: PlanInput,
): Promise<GraduationPlan> {
  const candidates = await generateCandidatePlans(input);
  return candidates[0];
}
