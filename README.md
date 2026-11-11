# DegreePilot AI 🎓

**AI-powered academic planning from a DegreeWorks PDF.** DegreePilot reads a student's degree audit, identifies remaining requirements, and recommends a course-by-course schedule aimed at **finishing as early as reasonably possible**—within a configurable two-year planning window.

Instead of suggesting random courses, it uses the student's actual audit, a course database, and backend validation to explain **what to take, when to take it, and what still needs verification**.

> **Status:** Working MVP (v0.1). Built initially around Brooklyn College B.S. Computer Science audits. DegreePilot is an independent project, not affiliated with Brooklyn College, CUNY, or DegreeWorks. Plans are provisional, not official graduation or enrollment approvals.

## Features

- **PDF-to-requirements:** Extracts courses, completed/in-progress work, credit totals, choices, and academic rules from a DegreeWorks PDF.
- **Personalized scheduling:** Recommends one schedule based on remaining requirements, a **1–4 course-per-term** preference, start term, and optional Summer/Winter sessions.
- **Earlier completion first:** Uses the two-year period as a *maximum planning horizon*, not a requirement to spread out courses.
- **Requirement and credit checks:** Flags missing courses, projected credit shortfalls, duplicate selections, and requirements that cannot yet be confirmed.
- **Database-backed checks:** Uses PostgreSQL course credits and available prerequisite records; incomplete rules are labeled **unknown**, not assumed satisfied.
- **One AI correction pass:** If validation finds actionable gaps, the AI gets one chance to revise; the backend revalidates and keeps the safer/better result.
- **Readable results:** Displays a semester timeline, conditional graduation-credit projection, missing requirements, and expandable warnings.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, CSS |
| Backend | Node.js, Express, TypeScript |
| AI | OpenAI API with structured outputs |
| PDF parsing and validation | PDF.js (`pdfjs-dist`), Zod |
| Database | Supabase PostgreSQL (`courses`, `prerequisite_groups`, `prerequisite_options`) |

## How it works

1. **Upload:** The student selects a DegreeWorks PDF and scheduling preferences in React.
2. **Extract:** Express receives the PDF; PDF.js converts its text into page-aware input. The OpenAI model extracts a structured academic audit.
3. **Validate the audit:** TypeScript checks the schema, cited text evidence, course statuses, and obvious contradictions.
4. **Generate a plan:** The AI proposes courses and semesters based on outstanding requirements.
5. **Check against data:** The backend consults PostgreSQL for known course credits/prerequisites, checks course choices and term limits, and calculates conditional requirement coverage and degree credits.
6. **Revise once if useful:** Actionable errors or gaps are sent back to the AI. The revised plan is checked again; an unsafe or worse revision is rejected.
7. **Show results:** React displays the selected plan, last proposed course term, projected credits, missing requirements, and unresolved conditions.

```text
Student → React frontend → Express API → PDF parser → OpenAI audit extraction
                                ↓
                         Audit validation
                                ↓
                      OpenAI schedule proposal
                                ↓
                 PostgreSQL + backend plan checks
                                ↓
                Optional AI revision → revalidation
                                ↓
                     JSON results → React UI
```

## Run locally

**Requirements:** Node.js, npm, an OpenAI API key, and a configured Supabase PostgreSQL database containing the relevant course/prerequisite tables and data.

**1. Install dependencies** in both project folders:

```bash
cd server && npm install
cd ../client && npm install
```

**2. Configure `server/.env`** (use your own credentials; never commit this file):

```dotenv
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=your_supported_model_id
DATABASE_URL=your_postgres_connection_string
# Optional for a private demo:
# DEGREEPILOT_DEMO_KEY=your_private_demo_code
```

**3. Optionally configure `client/.env`** if the API is not at the default `http://localhost:3001`:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
```

**4. Start each application in a separate terminal:**

```bash
# Terminal 1 — from server/
npm run dev

# Terminal 2 — from client/
npm run dev
```

Open the URL printed by Vite, select a **text-based** DegreeWorks PDF, choose your preferences, and click **Generate my plan**. The frontend sends a `POST /api/degreepilot/plan` request to the backend.

**Note:** `CLIENT_ORIGIN` must exactly match the browser's frontend origin (`localhost` and `127.0.0.1` are different origins). Database schema/data must be set up separately; `npm install` does not populate the catalog.

## Tests

From `server/`, run the offline tests without consuming OpenAI credits:

```bash
npx tsx src/scripts/test-plan-review-offline.ts
npx tsx src/scripts/test-planning-workflow-offline.ts
npx tsx src/scripts/test-graduation-coverage-offline.ts
```

A full PDF upload calls the OpenAI API and may incur usage charges. The backend limits upload size and request rate; production deployment should also use a private demo code or stronger authentication to protect API costs.

## Accuracy, privacy, and limitations

- **DegreeWorks is the student-specific starting point**, but its totals may already include in-progress courses. Those credits must not be added again.
- **Projected credits are conditional.** A 120/120 projection does not confirm residency, GPA, category allocation, grades, prerequisites, or graduation approval.
- **Prerequisites and course offerings may be incomplete or change.** Winter/Summer availability, session-specific credit limits, permissions, and institutional exceptions require independent confirmation.
- **AI can miss or misinterpret requirements.** The backend checks every *extracted* requirement, but does not guarantee that every line of the original PDF was extracted correctly.
- **Private student files:** Uploads are processed in server memory rather than saved as PDFs by this endpoint. Extracted audit text is sent to the configured OpenAI API for analysis; remove personal data from test fixtures and never commit real student records, `.env` files, or `.debug/` outputs.

## Who does what?

| Component | Role |
| --- | --- |
| **Frontend (React)** | Student uploads the PDF, chooses preferences, and views the resulting schedule and warnings. It calls the backend API; it does **not** call OpenAI or access database secrets directly. |
| **Backend (Express/TypeScript)** | **The coordinator.** Receives uploads, calls the PDF parser, LLM, and database, runs validators, decides whether an AI revision is useful, and returns one checked response. |
| **LLM (OpenAI)** | **The interpreter and planner.** Converts messy audit text into structured requirements, proposes a course schedule, and can revise it once using specific validation feedback. |
| **Database (Supabase PostgreSQL)** | **The reference data.** Stores known course credits and prerequisite rules used by backend checks; it is not the authority on a student's personal degree progress. |
| **Validators (TypeScript)** | **The safety net.** Check extraction evidence, scheduling rules, course assignments, credits, and unmet requirements. They flag unknowns rather than silently assuming graduation is possible. |

**In short:** **Frontend collects and displays → Backend coordinates → LLM understands and proposes → Database supplies course facts → Validators check → Backend returns the result.**
