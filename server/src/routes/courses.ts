import { Router } from "express";
import { db } from "../db/pool.ts";

const router = Router();

router.get("/:id", async (req, res) => {
  const rawId = req.params.id;

  if (typeof rawId !== "string") {
    res.status(400).json({ error: "Invalid course ID" });
    return;
  }

  const courseId = rawId.trim().toUpperCase();

  try {
    const result = await db.query(
      `SELECT id, title, credits
       FROM public.courses
       WHERE id = $1`,
      [courseId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: "Course not found",
      });
      return;
    }

    res.json({
      status: "ok",
      course: result.rows[0],
    });
  } catch (error) {
    console.error("Course lookup failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;
