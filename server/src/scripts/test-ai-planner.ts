import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseAcademicAudit } from "../services/audit-schema.ts";
import { validateAcademicAudit } from "../services/audit-validator.ts";
import { generateReviewedTwoYearPlan } from "../services/planning-workflow.ts";
import type { EvidenceIssue } from "../services/audit-extraction.ts";
import type { PlanningPreferences } from "../services/ai-plan-schema.ts";
import { db } from "../db/pool.ts";

async function main() {
  const fixturePath = process.argv[2] ?? ".debug/audit-terra.json";
  const outputPath = process.argv[3] ?? ".debug/ai-plan-terra-reviewed.json";
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY is missing.");
  const saved = JSON.parse(await readFile(fixturePath, "utf8"));
  const audit = parseAcademicAudit(saved.audit);
  const auditCheck = validateAcademicAudit(
    audit,
    saved.evidenceIssues as EvidenceIssue[],
  );
  console.log(
    `Audit: ${auditCheck.errors.length} errors, ${auditCheck.warnings.length} warnings`,
  );
  if (!auditCheck.canDraftPlan)
    throw new Error("Audit cannot be planned safely.");
  const preferences: PlanningPreferences = {
    startTerm: { year: 2027, season: "Fall" },
    maxCoursesPerSemester: 3,
    includeSummer: false,
    includeWinter: false,
  };
  const result = await generateReviewedTwoYearPlan(
    audit,
    auditCheck,
    preferences,
  );
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(
    outputPath,
    JSON.stringify({ preferences, ...result }, null, 2),
    { mode: 0o600 },
  );
  console.log("Model:", result.model, "Total usage:", result.tokenUsage);
  for (const term of result.plan.semesters) {
    console.log(
      `${term.season} ${term.year}:`,
      term.courses.map((c) => c.courseId).join(", ") || "(no classes)",
    );
  }
  console.log("Last proposed course term:", result.finalProposedTerm);
  console.log("AI revision:", result.revision);
  console.log(
    "Can display provisional schedule:",
    result.validation.canDisplayProvisionalPlan,
  );
  console.log("Graduation status:", result.graduationStatus);
  console.log(
    "Missing requirements:",
    result.validation.graduationCoverage.missing.map(
      (r) => `${r.requirementId}: ${r.explanation}`,
    ),
  );
  console.log(
    "Unverified/conditional:",
    result.validation.graduationCoverage.uncertain.length,
  );
  console.log(
    "Credit projection:",
    result.validation.graduationCoverage.degreeCredits,
  );
  console.log("Blocking errors:", result.validation.errors);
  console.log("Saved private result:", outputPath);
  if (!result.validation.canDisplayProvisionalPlan) process.exitCode = 1;
}
main()
  .catch((error) => {
    console.error(
      "Planning failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
