import "dotenv/config";
import { db } from "../db/pool.ts";
import { generateGraduationPlan } from "../services/planner.ts";
import type { DegreeRequirement } from "../services/requirements.ts";

// DEMO AUDIT ONLY: not the complete Brooklyn College B.S. degree requirements.
// Every course below is intentionally listed as required or as an explicit option.
const requirements: DegreeRequirement[] = [
  { id: "required-3225", type: "required", courseId: "CISC 3225" },
  { id: "required-3410", type: "required", courseId: "CISC 3410" },
  {
    id: "one-theory-course",
    type: "choose",
    count: 1,
    options: ["CISC 3220", "CISC 3230"],
  },
  {
    id: "two-advanced-electives",
    type: "choose",
    count: 2,
    options: ["CISC 3810", "CISC 3440", "CISC 3325"],
  },
];

async function main() {
  try {
    const plan = await generateGraduationPlan({
      completedCourses: [
        "CISC 1215",
        "CISC 2210",
        "CISC 3130",
        "MATH 1201",
        "MATH 2001",
      ],
      requirements,
      maxCoursesPerSemester: 2,
      includeSummer: false,
      includeWinter: false,
      startTerm: { year: 2027, season: "Fall" },
    });
    console.log(JSON.stringify(plan, null, 2));
    console.log(
      "Courses placed:",
      plan.semesters.flatMap((s) => s.courses.map((c) => c.courseId)),
    );
    console.log("Still required:", plan.remainingRequiredCourses);
    console.log("Outstanding choices:", plan.remainingChoiceGroups);
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
