import { z } from "zod";

// Every AI-extracted claim must point back to words on a specific PDF page.
export const EvidenceSchema = z.object({
  page: z.number().int().positive(),
  quote: z.string().min(1),
});

export const AuditCourseSchema = z.object({
  courseId: z.string().min(1),
  status: z.enum(["completed", "in_progress", "not_allowed", "unknown"]),
  credits: z.number().nonnegative().nullable(),
  grade: z.string().nullable(),
  term: z.string().nullable(),
  evidence: EvidenceSchema,
});

// The LLM extracts what the audit actually states, including difficult cases.
// Unsupported requirements stay "complex" instead of being made up or dropped.
export const RequirementRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("required_course"), courseId: z.string().min(1) }),
  z.object({
    kind: z.literal("choose_courses"),
    count: z.number().int().positive(),
    options: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("course_range"),
    count: z.number().int().positive(),
    subject: z.string().min(1),
    minNumber: z.number().int().nonnegative(),
    maxNumber: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("credit_minimum"),
    required: z.number().nonnegative(),
    applied: z.number().nonnegative().nullable(),
    remaining: z.number().nonnegative().nullable(),
    eligibleCourseText: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("complex"),
    description: z.string().min(1),
  }),
]);

export const AuditRequirementSchema = z.object({
  id: z.string().min(1),
  section: z.string().min(1),
  status: z.enum(["complete", "in_progress", "still_needed", "unknown"]),
  originalText: z.string().min(1),
  rule: RequirementRuleSchema,
  evidence: EvidenceSchema,
});

// Policies are extracted from this PDF, not inserted from a school-specific prompt.
export const AuditPolicySchema = z.object({
  category: z.enum(["exclusion", "sharing", "residency", "grade", "other"]),
  statement: z.string().min(1),
  evidence: EvidenceSchema,
});

export const AcademicAuditSchema = z.object({
  institution: z.string().min(1),
  program: z.string().min(1),
  auditDate: z.string().nullable(),
  catalog: z.string().nullable(),
  courses: z.array(AuditCourseSchema),
  requirements: z.array(AuditRequirementSchema),
  policies: z.array(AuditPolicySchema),
  unresolved: z.array(z.string()),
});

export type AcademicAudit = z.infer<typeof AcademicAuditSchema>;

/** Schema validity isn't the same as academic correctness. */
export function parseAcademicAudit(value: unknown): AcademicAudit {
  const audit = AcademicAuditSchema.parse(value);
  const ids = audit.requirements.map(req => req.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Extracted requirements contain duplicate IDs.");
  }
  return audit;
}
