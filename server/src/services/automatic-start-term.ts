import type { AcademicAudit } from "./audit-schema.ts";
import type { AcademicTerm, Season } from "./ai-plan-schema.ts";

// Academic planning cutoffs, not verified registration or course-offering dates.
// Selecting a term that has already begun risks recommending courses too late.
const termStarts: { season: Season; month: number; day: number }[] = [
  { season: "Winter", month: 1, day: 1 },
  { season: "Spring", month: 1, day: 20 },
  { season: "Summer", month: 5, day: 20 },
  { season: "Fall", month: 8, day: 20 },
];

const seasonIndex: Record<Season, number> = {
  Winter: 0,
  Spring: 1,
  Summer: 2,
  Fall: 3,
};

const termPosition = (term: AcademicTerm) =>
  term.year * 4 + seasonIndex[term.season];

function easternDate(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const value = (part: "year" | "month" | "day") =>
    Number(parts.find((p) => p.type === part)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** Only trust an explicit year + season in an in-progress course's term field. */
function parseCourseTerm(term: string | null): AcademicTerm | null {
  if (!term) return null;
  const normalized = term
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toUpperCase();
  const yearText = normalized.match(/\b(?:19|20)\d{2}\b/)?.[0];
  if (!yearText) return null;
  const tokens = normalized.split(/[^A-Z]+/).filter(Boolean);
  const aliases: Record<string, Season> = {
    WINTER: "Winter", WI: "Winter", SPRING: "Spring", SP: "Spring",
    SUMMER: "Summer", SU: "Summer", FALL: "Fall", AUTUMN: "Fall", FA: "Fall",
  };
  const season = tokens.map((token) => aliases[token]).find(Boolean);
  return season ? { year: Number(yearText), season } : null;
}

/**
 * Pick the earliest future term that is enabled and not already represented
 * by a dated in-progress course in the audit. The AI plans within this window;
 * it cannot invent or change the starting academic term.
 */
export function chooseAutomaticStartTerm(
  audit: Pick<AcademicAudit, "courses">,
  options: { includeSummer: boolean; includeWinter: boolean },
  now: Date = new Date(),
): AcademicTerm {
  const today = easternDate(now);
  const todayNumber = today.year * 10000 + today.month * 100 + today.day;
  const latestInProgress = audit.courses
    .filter((course) => course.status === "in_progress")
    .map((course) => parseCourseTerm(course.term))
    .filter((term): term is AcademicTerm => term !== null)
    .reduce((latest, term) => Math.max(latest, termPosition(term)), -Infinity);

  for (let year = today.year; year <= today.year + 5; year++) {
    for (const term of termStarts) {
      if (term.season === "Summer" && !options.includeSummer) continue;
      if (term.season === "Winter" && !options.includeWinter) continue;
      if (year * 10000 + term.month * 100 + term.day <= todayNumber) continue;
      const candidate: AcademicTerm = { year, season: term.season };
      if (termPosition(candidate) <= latestInProgress) continue;
      return candidate;
    }
  }
  throw new Error("Could not determine an upcoming academic term.");
}
