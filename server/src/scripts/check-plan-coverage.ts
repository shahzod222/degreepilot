import "dotenv/config";
import { readFile } from "node:fs/promises";
import { parseAcademicAudit } from "../services/audit-schema.ts";
import {
  AiPlanSchema,
  PlanningPreferencesSchema,
} from "../services/ai-plan-schema.ts";
import { validateProposedPlan } from "../services/plan-validator.ts";

async function main() {
  const auditPath = process.argv[2] ?? ".debug/audit-terra.json";
  const planPath = process.argv[3] ?? ".debug/ai-plan-terra.json";
  const useDb = process.argv.includes("--db");
  const savedAudit = JSON.parse(await readFile(auditPath, "utf8"));
  const savedPlan = JSON.parse(await readFile(planPath, "utf8"));
  const audit = parseAcademicAudit(savedAudit.audit);
  const plan = AiPlanSchema.parse(savedPlan.plan);
  const prefs = PlanningPreferencesSchema.parse(savedPlan.preferences);

  let report;
  if (useDb) {
    // Dynamically import only when the user requests DB access.
    const { validateProposedPlanWithDb } =
      await import("../services/plan-db-checks.ts");
    const { db } = await import("../db/pool.ts");
    try {
      const checked = await validateProposedPlanWithDb(plan, audit, prefs);
      report = checked.validation;
      console.log(
        "DB course credits missing for:",
        checked.missingDatabaseCreditValues.join(", ") || "none",
      );
      console.log("Prerequisite checks:");
      for (const p of checked.prerequisites)
        console.log(`  ${p.courseId}: ${p.result} (${p.note})`);
    } finally {
      await db.end();
    }
  } else {
    report = validateProposedPlan(plan, audit, prefs);
  }
  const c = report.graduationCoverage;
  console.log("Plan structure valid:", report.canDisplayProvisionalPlan);
  console.log(
    "All extracted requirements conditionally covered:",
    c.allExtractedRequirementsConditionallyCovered,
  );
  console.log("Outstanding requirements:", c.missing.length);
  for (const r of c.missing)
    console.log(`  MISSING ${r.requirementId}: ${r.explanation}`);
  console.log("Unverified/conditional requirements:", c.uncertain.length);
  for (const r of c.uncertain)
    console.log(`  REVIEW ${r.requirementId}: ${r.explanation}`);
  if (c.degreeCredits) {
    console.log(
      "Degree credits applied (includes IP):",
      c.degreeCredits.appliedIncludingIP,
    );
    console.log(
      "Additional known planned credits:",
      c.degreeCredits.knownAdditional,
    );
    console.log(
      "Credits missing data for:",
      c.degreeCredits.missingCreditValuesFor.join(", ") || "none",
    );
    console.log(
      "Projected credits (conditional):",
      c.degreeCredits.projectedTotalIfCoursesCount ?? "unknown",
    );
    console.log(
      "Remaining degree credits:",
      c.degreeCredits.remainingIfKnown ?? "unknown",
    );
  } else
    console.log(
      "Overall degree-credit requirement not reliably identified; needs review.",
    );
  console.log("Audit unresolved notes:", c.unresolvedAuditNotes);
  console.log("Can certify graduation:", c.canCertifyGraduation);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Unknown error");
  process.exitCode = 1;
});
