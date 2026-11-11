import assert from "node:assert/strict";
import type { AcademicAudit } from "../services/audit-schema.ts";
import { chooseAutomaticStartTerm } from "../services/automatic-start-term.ts";

const now = new Date("2026-11-11T18:00:00Z");
const empty: Pick<AcademicAudit, "courses"> = { courses: [] };
const normal = { includeSummer: false, includeWinter: false };
function withInProgress(term: string): Pick<AcademicAudit, "courses"> {
  return {
    courses: [{
      courseId: "TEST 1000",
      status: "in_progress",
      credits: 3,
      grade: "IP",
      term,
      evidence: { page: 1, quote: "IP" },
    }],
  };
}

assert.deepEqual(chooseAutomaticStartTerm(empty, normal, now), {
  season: "Spring", year: 2027,
});
assert.deepEqual(chooseAutomaticStartTerm(empty, { ...normal, includeWinter: true }, now), {
  season: "Winter", year: 2027,
});
assert.deepEqual(chooseAutomaticStartTerm(empty, normal, new Date("2026-07-11T18:00:00Z")), {
  season: "Fall", year: 2026,
});
assert.deepEqual(chooseAutomaticStartTerm(withInProgress("Spring 2027"), {
  ...normal, includeSummer: true,
}, now), { season: "Summer", year: 2027 });
assert.deepEqual(chooseAutomaticStartTerm(withInProgress("2027SP"), normal, now), {
  season: "Fall", year: 2027,
});
assert.deepEqual(chooseAutomaticStartTerm(withInProgress("FA2026"), normal, now), {
  season: "Spring", year: 2027,
});
assert.deepEqual(chooseAutomaticStartTerm(empty, {
  ...normal, includeSummer: true,
}, new Date("2027-02-05T17:00:00Z")), { season: "Summer", year: 2027 });

console.log("PASS: automatic term selection honors upcoming dates, sessions and in-progress terms");
