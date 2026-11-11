# Lesson 01 — The server and the API

## Goal
Understand what happens when a React button triggers an HTTP request to the Node.js backend.

## Request lifecycle
1. Run `npm run dev:server` to start the API. `tsx watch` executes `server/src/index.ts` and reruns after changes.
2. Express creates an HTTP listener on `PORT` (default 3001) and waits for requests.
3. React, served by Vite on port 5173, calls `GET http://localhost:3001/api/health`.
4. Express matches `app.get('/api/health', ...)`, creates a JSON response, and returns it.
5. React calls `response.json()` and updates the page.

## Why two ports?
Both services run on your laptop, but separate processes listen at different ports. This is normal during local development.

## What the backend is NOT
It's not a bridge that simply forwards every request. It will contain our API routes, validation and scheduling logic, permissions, and integrations with the database and LLM provider.

## Where the database will fit
The future API endpoint might execute:

```ts
// Learning illustration only. Not implemented in Stage 1.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const result = await pool.query(
  'SELECT course_id, title FROM courses WHERE course_id = $1',
  ['CISC 4900']
);
```

The `pg` driver talks to PostgreSQL using its own database protocol; this is **not a browser-facing HTTP route**. The connection string is a secret, stored on the backend. For Supabase, choose the recommended connection string/pooling mode for the hosting environment and configure TLS.

Later the frontend calls `GET /api/courses/CISC%204900`, our backend executes the query, and only returns safe fields such as `courseId` and `title` as JSON. The frontend never receives `DATABASE_URL`.

## How the server works after deployment
- Frontend host (e.g. Vercel): compiles the React/Vite application into static JavaScript/CSS/HTML and hosts those files.
- API host (e.g. Render): installs dependencies, compiles TypeScript to JavaScript, then runs `npm start`. Our `app.listen(...)` binds the provided `PORT` on `0.0.0.0`.
- Database host (e.g. Supabase): separately runs PostgreSQL; the API connects using a private environment variable.
- On free Render web services, instances can spin down after inactivity. On restart, the host runs the service again. We must not rely on local server files for durable storage.

## Your practice (without copy-paste)
1. Open `server/src/index.ts`; explain what each line does.
2. Run the backend and open `http://localhost:3001/api/health` in the browser.
3. Start React and click **Check backend connection**.
4. Change `degreepilot-api` to `degreepilot-cs-api`; confirm the page shows the new value.
5. Add a *new* Express route `GET /api/version` that returns `{ "version": "0.1.0" }` and verify it in the browser. Try this yourself first.

## Stop point
Do NOT add database credentials or real DegreeWorks PDFs yet. Our next milestone is a simple course lookup using **mocked** data, then a real PostgreSQL connection.
