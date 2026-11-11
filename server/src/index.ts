import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "./db/pool.ts";
import courseRoutes from "./routes/courses.ts";
import degreepilotRouter from "./routes/degreepilot.ts";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173";

app.set("trust proxy", 1);
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());
app.use(degreepilotRouter);

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "degreepilot-api",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/version", (_request, response) => {
  response.json({
    status: "ok",
    version: "0.1.0",
  });
});

app.get("/api/db-health", async (_request, response) => {
  try {
    const result = await db.query("SELECT NOW() AS database_time");

    response.json({
      status: "connected",
      databaseTime: result.rows[0].database_time,
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    response.status(503).json({
      status: "error",
      message: "Database unavailable",
    });
  }
});

app.use("/api/courses", courseRoutes);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DegreePilot API listening on http://localhost:${PORT}`);
});
