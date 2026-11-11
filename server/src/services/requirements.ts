/**
 * DegreePilot v0.1: academic requirements supplied by a sample audit or PDF extraction.
 * A course can be used for only ONE requirement slot. This deliberately avoids
 * unverified academic double-counting exceptions.
 */
export type DegreeRequirement =
  | { id: string; type: "required"; courseId: string }
  | { id: string; type: "choose"; count: number; options: string[] };

export interface ChoiceGroup {
  id: string;
  needed: number;
  options: string[];
}

export interface RequirementCoverage {
  totalSlots: number;
  fulfilledSlots: number;
  requiredCourses: string[];
  choiceGroups: ChoiceGroup[];
  /** Course IDs that currently fulfill each requirement. */
  allocations: Record<string, string[]>;
}

export function normalizeCourses(ids: string[]): string[] {
  return [...new Set(ids.map(id => id.trim().toUpperCase()).filter(Boolean))];
}

/**
 * Find the maximum number of independent requirement slots satisfied.
 * Required courses take precedence; a course cannot satisfy multiple choice slots.
 * For overlapping choice groups, an augmenting-path matcher can reassign a course
 * so that the greatest possible number of slots is fulfilled.
 */
export function evaluateRequirements(
  requirements: DegreeRequirement[],
  completedOrPlannedCourses: string[]
): RequirementCoverage {
  const taken = new Set(normalizeCourses(completedOrPlannedCourses));
  const ids = new Set<string>();
  const required = new Set<string>();
  const choices: Array<{ id: string; count: number; options: string[] }> = [];

  for (const req of requirements) {
    if (!req.id || ids.has(req.id)) {
      throw new Error(`Duplicate or empty requirement ID: ${req.id}`);
    }
    ids.add(req.id);
    if (req.type === "required") {
      const courseId = req.courseId.trim().toUpperCase();
      if (!courseId) throw new Error(`Empty required course: ${req.id}`);
      if (required.has(courseId)) {
        throw new Error(`Required course listed twice: ${courseId}`);
      }
      required.add(courseId);
    } else {
      const options = normalizeCourses(req.options);
      if (!Number.isInteger(req.count) || req.count < 1 || req.count > options.length) {
        throw new Error(`Invalid choice count: ${req.id}`);
      }
      choices.push({ id: req.id, count: req.count, options });
    }
  }

  const allocations: Record<string, string[]> = {};
  for (const req of requirements) allocations[req.id] = [];
  for (const req of requirements) {
    if (req.type === "required") {
      const courseId = req.courseId.trim().toUpperCase();
      if (taken.has(courseId)) allocations[req.id] = [courseId];
    }
  }

  // Each choice requirement is expanded into count independent slots.
  const slots = choices.flatMap(group =>
    Array.from({ length: group.count }, () => ({
      id: group.id,
      options: group.options.filter(course => !required.has(course))
    }))
  ).sort((a, b) => a.options.length - b.options.length || a.id.localeCompare(b.id));
  const assigned = new Map<string, number>(); // course ID -> slot index

  function assign(slotIndex: number, seen: Set<string>): boolean {
    for (const courseId of slots[slotIndex].options) {
      if (!taken.has(courseId) || seen.has(courseId)) continue;
      seen.add(courseId);
      const otherSlot = assigned.get(courseId);
      if (otherSlot === undefined || assign(otherSlot, seen)) {
        assigned.set(courseId, slotIndex);
        return true;
      }
    }
    return false;
  }
  for (let slot = 0; slot < slots.length; slot++) {
    assign(slot, new Set());
  }
  for (const [courseId, slotIndex] of assigned) {
    allocations[slots[slotIndex].id].push(courseId);
  }

  const requiredCourses = [...required].filter(courseId => !taken.has(courseId));
  const choiceGroups = choices
    .map(group => ({
      id: group.id,
      needed: group.count - allocations[group.id].length,
      options: group.options.filter(course => !taken.has(course) && !required.has(course))
    }))
    .filter(group => group.needed > 0);

  const totalSlots = required.size + choices.reduce((sum, group) => sum + group.count, 0);
  const fulfilledSlots = totalSlots - requiredCourses.length -
    choiceGroups.reduce((sum, group) => sum + group.needed, 0);

  return { totalSlots, fulfilledSlots, requiredCourses, choiceGroups, allocations };
}

/** Exposes exactly the simpler shape taught in our previous lesson. */
export function analyzeRequirements(
  requirements: DegreeRequirement[],
  completedCourses: string[]
): { requiredCourses: string[]; choiceGroups: ChoiceGroup[] } {
  const { requiredCourses, choiceGroups } = evaluateRequirements(requirements, completedCourses);
  return { requiredCourses, choiceGroups };
}
