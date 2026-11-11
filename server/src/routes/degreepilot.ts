import { Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { extractAcademicAuditFromPdf } from "../services/audit-extraction.ts";
import { validateAcademicAudit } from "../services/audit-validator.ts";
import { PlanningPreferencesSchema } from "../services/ai-plan-schema.ts";
import { generateReviewedTwoYearPlan } from "../services/planning-workflow.ts";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== "application/pdf")
      return callback(new Error("Only PDF uploads are allowed."));
    callback(null, true);
  },
});

// Defense in depth against unexpected API bills. For a public demo, use a
// manually entered demo access code; DO NOT embed it in frontend environment vars.

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: {
    forwardedHeader: false,
  },
});

router.post(
  "/api/degreepilot/plan",
  limiter,
  (req, res, next) => {
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.DEGREEPILOT_DEMO_KEY
    ) {
      res
        .status(503)
        .json({ error: "Demo API access has not been configured." });
      return;
    }
    if (
      process.env.DEGREEPILOT_DEMO_KEY &&
      req.get("x-degreepilot-demo-key") !== process.env.DEGREEPILOT_DEMO_KEY
    ) {
      res.status(401).json({ error: "Invalid demo access code." });
      return;
    }
    upload.single("degreeworks")(req, res, next);
  },
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Please upload a DegreeWorks PDF." });
        return;
      }
      if (
        !req.file.buffer.subarray(0, 1024).toString("latin1").includes("%PDF-")
      ) {
        res.status(400).json({ error: "Invalid PDF file." });
        return;
      }
      const preferences = PlanningPreferencesSchema.parse(
        JSON.parse(String(req.body.preferences ?? "{}")),
      );
      // No PDFs are saved; extraction calls API with store:false and removes common identifiers.
      const extracted = await extractAcademicAuditFromPdf(req.file.buffer);
      const auditCheck = validateAcademicAudit(
        extracted.audit,
        extracted.evidenceIssues,
      );
      if (!auditCheck.canDraftPlan) {
        res.status(422).json({
          error: "Audit could not be safely interpreted.",
          issues: auditCheck.errors,
        });
        return;
      }
      const reviewed = await generateReviewedTwoYearPlan(
        extracted.audit,
        auditCheck,
        preferences,
      );
      const coverage = reviewed.validation.graduationCoverage;
      res.json({
        plan: reviewed.plan,
        finalProposedTerm: reviewed.finalProposedTerm,
        graduationStatus: reviewed.graduationStatus,
        revision: reviewed.revision,
        coverage: {
          missing: coverage.missing,
          uncertain: coverage.uncertain,
          degreeCredits: coverage.degreeCredits,
          assessedRequirementCount: coverage.assessedRequirementCount,
          unresolvedAuditNotes: coverage.unresolvedAuditNotes,
        },
        validation: {
          canDisplayProvisionalPlan:
            reviewed.validation.canDisplayProvisionalPlan,
          errors: reviewed.validation.errors,
          warnings: reviewed.validation.warnings,
        },
        prerequisites: reviewed.prerequisites,
        limitations: [
          "Provisional plan; not proof of enrollment eligibility or official graduation.",
          "In-progress courses are treated as conditional on successful completion.",
        ],
      });
    } catch (error) {
      // Do not return PDF text, LLM prompts, secrets, or database error details.
      console.error(
        "DegreePilot planning request failed:",
        error instanceof Error ? error.name : "Unknown error",
      );
      res.status(500).json({
        error:
          "Could not generate a verified provisional plan. Check your PDF and server configuration.",
      });
    }
  },
);

export default router;
