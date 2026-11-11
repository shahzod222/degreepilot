import { readFile } from "node:fs/promises";
import { extractPdfText } from "../services/pdf-extraction.ts";

async function main() {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "Usage: npx tsx src/scripts/check-pdf-extraction.ts path/to/audit.pdf",
    );

  const pdf = await extractPdfText(await readFile(file));
  // Print ONLY diagnostics, never full student names, IDs, grades, or course history.
  console.log("Pages:", pdf.pageCount);
  console.log("Text characters:", pdf.text.length);

  const checks = [
    ["Degree credit summary", /credits required\s*:\s*120/i],
    ["College Option", /College Option/i],
    ["Computer Science section", /Computer Science/i],
    ["In-progress course section", /In-progress/i],
    ["Advanced residency section", /24 Advanced CISC Credits in Residence/i],
    ["Additional B.S. credit rule", /36 Additional Credits BS Degrees/i],
  ] as const;

  for (const [label, pattern] of checks) {
    const present = pattern.test(pdf.text.replace(/\s+/g, " "));
    console.log(`${present ? "OK" : "MISSING"}: ${label}`);
  }
}

main().catch((error) => {
  console.error("PDF extraction test failed:", error.message);
  process.exitCode = 1;
});
