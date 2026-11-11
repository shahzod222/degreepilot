import "dotenv/config";
import { readFile } from "node:fs/promises";
import { parseAcademicAudit } from "../services/audit-schema.ts";
import { extractPdfText } from "../services/pdf-extraction.ts";
import { validateAcademicAudit } from "../services/audit-validator.ts";
import { checkAuditEvidence } from "../services/audit-extraction.ts";

async function main() {
  const [jsonFile, pdfFile] = process.argv.slice(2);
  if (!jsonFile || !pdfFile) {
    throw new Error(
      "Usage: npx tsx src/scripts/check-audit-validator.ts .debug/audit-terra.json src/services/sample-dw.pdf",
    );
  }

  const raw: unknown = JSON.parse(await readFile(jsonFile, "utf8"));
  // Accept either an audit directly or a saved { audit, ... } extraction result.
  const value =
    raw && typeof raw === "object" && "audit" in raw ? raw.audit : raw;
  const audit = parseAcademicAudit(value);
  const pdf = await extractPdfText(await readFile(pdfFile));
  const report = validateAcademicAudit(audit, checkAuditEvidence(audit, pdf));

  console.log("Can draft a provisional plan:", report.canDraftPlan);
  console.log("Errors:", report.errors.length);
  console.log("Warnings:", report.warnings.length);
  console.log("Human review required:", report.requiresHumanReview);

  for (const issue of [...report.errors, ...report.warnings]) {
    console.log(
      `${issue.severity.toUpperCase()} [${issue.code}] ${issue.path}: ${issue.message}`,
    );
  }

  // Return a failing exit status when input is unsafe for further automated use.
  if (!report.canDraftPlan) process.exitCode = 1;
}

main().catch((error) => {
  // Never print the full academic audit or PDF text to the terminal.
  console.error(
    "Validation failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
