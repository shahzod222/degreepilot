import "dotenv/config";
import { readFile } from "node:fs/promises";
import { extractAcademicAuditFromPdf } from "../services/audit-extraction.ts";

async function main() {
  const file = process.argv[2];
  if (!file) {
    throw new Error(
      "Usage: npx tsx src/scripts/test-audit-extraction.ts <path-to-degreeworks.pdf>",
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY in server/.env before running.");
  }

  const buffer = await readFile(file);
  const result = await extractAcademicAuditFromPdf(buffer);
  const { audit, evidenceIssues } = result;

  console.log("\nCISC courses to inspect:");

  console.table(
    audit.courses
      .filter(
        (c) =>
          /CISC/i.test(c.courseId) && /3130|3310|3610|3650/.test(c.courseId),
      )
      .map((c) => ({
        courseId: c.courseId,
        status: c.status,
        term: c.term,
        credits: c.credits,
      })),
  );

  console.log("\nRequired CISC courses:");

  console.dir(
    audit.requirements
      .filter((r) => /3140|3320|3142/.test(r.originalText))
      .map((r) => ({
        id: r.id,
        rule: r.rule,
      })),
    { depth: null },
  );

  // Deliberately print a high-level summary instead of the full student record.
  console.log("Institution:", audit.institution);
  console.log("Program:", audit.program);
  console.log("Audit date:", audit.auditDate ?? "not provided");
  console.log("Courses extracted:", audit.courses.length);
  console.log(
    "  completed:",
    audit.courses.filter((c) => c.status === "completed").length,
  );
  console.log(
    "  in progress:",
    audit.courses.filter((c) => c.status === "in_progress").length,
  );
  console.log(
    "  not allowed:",
    audit.courses.filter((c) => c.status === "not_allowed").length,
  );
  console.log("Requirements extracted:", audit.requirements.length);
  console.log("Policies extracted:", audit.policies.length);
  console.log("Unresolved notes:", audit.unresolved.length);
  console.log("Evidence issues:", evidenceIssues.length);
  console.log("Evidence quotes verified:", result.evidenceCheckPassed);
  console.log("Human audit review required:", result.requiresHumanReview);

  for (const issue of evidenceIssues.slice(0, 15)) {
    console.warn(`  page ${issue.page}, ${issue.item}: ${issue.problem}`);
  }
  if (evidenceIssues.length > 15) {
    console.warn(`  ... plus ${evidenceIssues.length - 15} more issues`);
  }

  // Basic audit-specific expectations for the seven-page development fixture.
  // This is a diagnostic, not a substitute for human review of the actual JSON.
  const hasCourse = (id: string, status: string) =>
    audit.courses.some(
      (c) =>
        c.courseId
          .replace(/\./g, "")
          .toUpperCase()
          .replace(/\s+/g, " ")
          .trim() === id && c.status === status,
    );
  const checks = [
    ["CISC 3130 in progress", hasCourse("CISC 3130", "in_progress")],
    ["CISC 3310 in progress", hasCourse("CISC 3310", "in_progress")],
    ["CISC 3610 in progress", hasCourse("CISC 3610", "in_progress")],
    ["CISC 3650 in progress", hasCourse("CISC 3650", "in_progress")],
    [
      "11 in-progress courses",
      audit.courses.filter((c) => c.status === "in_progress").length === 11,
    ],
    [
      "5 excluded electives",
      audit.courses.filter((c) => c.status === "not_allowed").length === 5,
    ],
    [
      "CISC 3140 requirement",
      audit.requirements.some(
        (r) =>
          r.rule.kind === "required_course" &&
          r.rule.courseId.replace(/\./g, "").toUpperCase() === "CISC 3140",
      ),
    ],
    [
      "CISC 3320 requirement",
      audit.requirements.some(
        (r) =>
          r.rule.kind === "required_course" &&
          r.rule.courseId.replace(/\./g, "").toUpperCase() === "CISC 3320",
      ),
    ],
    [
      "CISC 3142 requirement",
      audit.requirements.some(
        (r) =>
          r.rule.kind === "required_course" &&
          r.rule.courseId.replace(/\./g, "").toUpperCase() === "CISC 3142",
      ),
    ],
    [
      "120-credit minimum",
      audit.requirements.some(
        (r) => r.rule.kind === "credit_minimum" && r.rule.required === 120,
      ),
    ],
  ] as const;
  for (const [name, passed] of checks)
    console.log(`${passed ? "OK" : "REVIEW"}: ${name}`);
}

main().catch((error) => {
  // Avoid logging the full API error object because it might include request data.
  console.error(
    "Extraction failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
