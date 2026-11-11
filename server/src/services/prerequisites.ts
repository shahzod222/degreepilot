import { db } from "../db/pool.ts";

type Status = "satisfied" | "missing" | "needs_review";

interface PrerequisiteRow {
  group_number: number;
  verification_status: "draft" | "verified";
  requirement_type: "course" | "course_level" | "permission";
  required_course_id: string | null;
  subject: string | null;
  course_number_above: number | null;
  description: string | null;
}

export async function getPrerequisites(courseId: string) {
  const result = await db.query<PrerequisiteRow>(
    `SELECT
       g.group_number,
       o.requirement_type,
       o.required_course_id,
       o.subject,
       o.course_number_above,
       o.description
     FROM public.prerequisite_groups AS g
     JOIN public.prerequisite_options AS o
       ON g.id = o.group_id
     WHERE g.course_id = $1
     ORDER BY g.group_number, o.id`,
    [courseId.trim().toUpperCase()],
  );

  return result.rows;
}

function evaluateOption(row: PrerequisiteRow, completed: Set<string>): Status {
  // Case 1: A specific required course
  if (row.requirement_type === "course") {
    if (!row.required_course_id) {
      return "needs_review";
    }

    return completed.has(row.required_course_id) ? "satisfied" : "missing";
  }

  // Case 2: A course above a specific level
  if (row.requirement_type === "course_level") {
    if (!row.subject || row.course_number_above === null) {
      return "needs_review";
    }

    for (const courseId of completed) {
      const match = courseId.match(/^([A-Z]+)\s+(\d{4})$/);

      if (!match) continue;

      const subject = match[1];
      const number = Number(match[2]);

      if (
        subject === row.subject.toUpperCase() &&
        number > row.course_number_above
      ) {
        return "satisfied";
      }
    }

    return "missing";
  }

  // Case 3: Departmental permission
  // We cannot verify this from course history.
  return "needs_review";
}

export async function checkPrerequisites(
  courseId: string,
  completedCourses: string[],
) {
  // 1. Retrieve prerequisites from PostgreSQL
  const rows = await getPrerequisites(courseId);

  if (rows.length === 0) {
    return {
      courseId,
      status: "unknown",
      reason: "No prerequisite rules in database",
      groups: [],
    };
  }

  // 2. Normalize completed course IDs
  const completed = new Set(
    completedCourses.map((id) => id.trim().toUpperCase()),
  );

  // 3. Organize rows by group number
  const grouped = new Map<number, PrerequisiteRow[]>();

  for (const row of rows) {
    const options = grouped.get(row.group_number) ?? [];

    options.push(row);
    grouped.set(row.group_number, options);
  }

  // 4. Evaluate each group
  const groups = Array.from(grouped.entries()).map(([groupNumber, options]) => {
    const results = options.map((option) => evaluateOption(option, completed));

    let status: Status;

    if (results.includes("satisfied")) {
      status = "satisfied";
    } else if (results.includes("needs_review")) {
      status = "needs_review";
    } else {
      status = "missing";
    }

    return {
      groupNumber,
      status,
    };
  });

  // 5. Determine overall prerequisite status
  let status: Status = "satisfied";

  if (groups.some((g) => g.status === "missing")) {
    status = "missing";
  } else if (groups.some((g) => g.status === "needs_review")) {
    status = "needs_review";
  }

  return {
    courseId,
    status,
    groups,
  };
}
