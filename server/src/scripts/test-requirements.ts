import {
  analyzeRequirements,
  evaluateRequirements,
  type DegreeRequirement,
} from "../services/requirements.ts";

const completedCourses = ["CISC 1115", "CISC 2210", "CISC 3810"];
const requirements: DegreeRequirement[] = [
  { id: "modern-programming", type: "required", courseId: "CISC 3115" },
  { id: "data-structures", type: "required", courseId: "CISC 3130" },
  {
    id: "theory-choice",
    type: "choose",
    count: 1,
    options: ["CISC 3220", "CISC 3230"],
  },
  {
    id: "advanced-electives",
    type: "choose",
    count: 3,
    options: ["CISC 3410", "CISC 3810", "CISC 3440", "CISC 3325"],
  },
];

console.log("Outstanding requirements:");
console.log(
  JSON.stringify(analyzeRequirements(requirements, completedCourses), null, 2),
);

const overlapping: DegreeRequirement[] = [
  {
    id: "group-a",
    type: "choose",
    count: 1,
    options: ["COURSE X", "COURSE Y"],
  },
  {
    id: "group-b",
    type: "choose",
    count: 1,
    options: ["COURSE X", "COURSE Z"],
  },
];
const coverage = evaluateRequirements(overlapping, ["COURSE X"]);
console.log(
  "Overlapping groups: X can count for one slot only:",
  coverage.fulfilledSlots,
  "/",
  coverage.totalSlots,
);
if (coverage.fulfilledSlots !== 1) throw new Error("Course double-counted!");
