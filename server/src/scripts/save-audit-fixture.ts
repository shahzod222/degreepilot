import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractAcademicAuditFromPdf } from "../services/audit-extraction.ts";

async function main() {
  const pdfPath = process.argv[2];
  const outputPath = process.argv[3] ?? ".debug/audit-terra.json";

  if (!pdfPath) {
    throw new Error(
      "Usage: npx tsx src/scripts/save-audit-fixture.ts src/services/sample-dw.pdf [.debug/audit-terra.json]",
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing in server/.env");
  }

  // This script makes ONE paid LLM call. Subsequent validation tests make none.
  const result = await extractAcademicAuditFromPdf(await readFile(pdfPath));
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, JSON.stringify(result, null, 2), { mode: 0o600 });

  console.log("Saved private extraction to:", outputPath);
  console.log("Courses:", result.audit.courses.length);
  console.log("Requirements:", result.audit.requirements.length);
  console.log("Policies:", result.audit.policies.length);
  console.log("Evidence issues:", result.evidenceIssues.length);
  console.log(
    "Now run the offline validator against the saved JSON and original PDF.",
  );
}

main().catch((error) => {
  console.error(
    "Saving failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
