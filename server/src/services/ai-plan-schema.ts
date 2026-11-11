import { z } from "zod";

export const SeasonSchema = z.enum(["Winter", "Spring", "Summer", "Fall"]);
export type Season = z.infer<typeof SeasonSchema>;

export const PlanningPreferencesSchema = z.object({
  startTerm: z.object({ year: z.number().int(), season: SeasonSchema }),
  maxCoursesPerSemester: z.number().int().min(1).max(4),
  includeSummer: z.boolean(),
  includeWinter: z.boolean(),
});
export type PlanningPreferences = z.infer<typeof PlanningPreferencesSchema>;

// The browser only chooses workload and optional sessions. The server
// derives startTerm from the calendar and the extracted DegreeWorks audit.
export const PlanningOptionsSchema = PlanningPreferencesSchema.omit({
  startTerm: true,
});
export type PlanningOptions = z.infer<typeof PlanningOptionsSchema>;

// Every proposed course must be tied to specific IDs extracted from the audit.
// This is a proposed *schedule*, not a prediction of final graduation eligibility.
export const AiPlanSchema = z.object({
  semesters: z.array(z.object({
    year: z.number().int(),
    season: SeasonSchema,
    courses: z.array(z.object({
      courseId: z.string().min(1),
      requirementIds: z.array(z.string().min(1)).min(1),
      reason: z.string().min(1),
      prerequisiteNote: z.string(),
    })),
  })),
  overview: z.string().min(1),
  limitations: z.array(z.string()),
});
export type AiPlan = z.infer<typeof AiPlanSchema>;

export type AcademicTerm = { year: number; season: Season };
const seasons: Season[] = ["Winter", "Spring", "Summer", "Fall"];

// Exactly eight consecutive *calendar seasons*, NOT eight included semesters.
// Fall 2027 + 8 seasons -> through Summer 2029.
export function allowedTwoYearTerms(prefs: PlanningPreferences): AcademicTerm[] {
  const terms: AcademicTerm[] = [];
  let year = prefs.startTerm.year;
  let seasonIndex = seasons.indexOf(prefs.startTerm.season);
  for (let i = 0; i < 8; i++) {
    const season = seasons[seasonIndex];
    if ((season !== "Summer" || prefs.includeSummer) &&
        (season !== "Winter" || prefs.includeWinter)) {
      terms.push({ year, season });
    }
    seasonIndex = (seasonIndex + 1) % 4;
    if (seasonIndex === 0) year++;
  }
  return terms;
}

export function termKey(term: AcademicTerm): string {
  return `${term.year}-${term.season}`;
}
