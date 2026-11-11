# DegreePilot — Stage 1 (Learning Scaffold)

**Scope:** Brooklyn College B.S. Computer Science. This stage has **no PDF upload, OpenAI calls, student data, or PostgreSQL connection yet**. It proves frontend ↔ backend communication. The MVP scope and architecture live in `docs/architecture.md`.

## Requirements
- Node.js **22.12+** (see Vite compatibility requirements)
- npm
- VS Code or another editor

## Install
From the directory containing this `README.md`:

```bash
npm install
```

## Start the two processes (two terminal tabs)

Terminal 1:
```bash
npm run dev:server
```

Terminal 2:
```bash
npm run dev:client
```

Visit `http://localhost:5173` and click **Check backend connection**. Or visit `http://localhost:3001/api/health` to see the server response directly.

Expected example response (timestamp varies):
```json
{"status":"ok","service":"degreepilot-api","timestamp":"2026-11-08T12:00:00.000Z"}
```

## Folder responsibilities
- `client/`: React UI. Browser receives public JS and CSS; no secrets.
- `server/`: Express API. Coordinates PDF parsing, OpenAI, validation, scheduling and database access later.
- `server/src/routes/`: API routes later (HTTP input/output).
- `server/src/services/`: domain logic later (not tied to HTTP).
- `server/src/db/`: database driver and queries later.
- `docs/`: architecture and lessons.
- `data/`: curated academic example/source data later.

## How production works (future)
- Vercel hosts the **frontend** (built static files).
- Render runs the **Express backend** using its Web Service. Set root directory to `server`, build command `npm install && npm run build`, start command `npm start`, and configure `CLIENT_ORIGIN` to the actual Vercel frontend URL. Render supplies a port and the server binds `0.0.0.0`.
- Supabase hosts PostgreSQL. The backend uses a **database connection string**, normally with the `pg` library, held in the server's `DATABASE_URL` environment variable. Supabase's direct/session pool connection choice depends on network/IPv4 and runtime.
- Later set `VITE_API_BASE_URL` on the Vercel frontend to the public Render API origin. A `VITE_` variable is public and must **never** contain a database password or OpenAI key.

**No cloud account is needed for today's exercise.** Read `docs/lesson-01.md` and then attempt its practice tasks.
