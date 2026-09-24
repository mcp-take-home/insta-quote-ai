# PDF Extraction Assessment Implementation Plan

> **For agentic workers:** Use subagent-driven-development task by task. Checkboxes track completion.

**Goal:** Upload PDFs, process asynchronously, return evidenced line items and plain-language refusals, show both in a small web app.

**Architecture:** Bun workspace with Turborepo tasks; Hono API owns SQLite queue and PDF processing; shared package owns Zod domain schemas; Vite React app uploads and polls. PDF.js positioned tokens from `../test/utils/pdf.ts` drive deterministic row parsing.

**Tech Stack:** Current Bun, Turbo, TypeScript, Hono, React, Vite, React Router, TanStack Query, SQLite, Drizzle ORM, Zod, pdfjs-dist, bun:test.

## Global constraints

- Work only under `submission/`; read but never change `../test/`; sample PDFs stay in `../data/`.
- Initialize projects and add libraries using current official CLIs. Use Bun workspaces and Turborepo.
- Finish and verify backend before starting frontend code.
- Every emitted numeric value needs 1-based page and exact PDF token source text. Never infer missing numbers.
- A bad row or unreadable page creates a refusal without discarding other good rows. Refusals are successful completed results.
- Keep UI simple and refusal messages legible. No OCR, LLM, Redis, WebSocket, authentication, or extra infrastructure.
- Commit milestones in `submission/.git`; keep `CLAUDE.md` a symlink to `AGENTS.md`.

## Task 1: Workspace and contracts

**Files:** `package.json`, `turbo.json`, `apps/api/*`, `packages/shared/*`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`.

**Interface:** shared exports `Evidence`, `SourcedNumber`, `ExtractedItem`, `Refusal`, `DocumentResponse`, and Zod schemas. API owns `POST /api/docs` and `GET /api/docs/:id`.

- [x] Set up the root, API, and shared workspace packages.
- [x] Set Bun workspaces to `apps/*`, `packages/*`; add Turbo `dev`, `build`, `check`, `test` tasks. Create short agent instructions and symlink.
- [x] Define Zod evidence and response schemas: every numeric item field requires `{ value, evidence: { page, sourceText, contextText? } }`; status discriminant distinguishes queued, processing, completed, failed.
- [x] Run `bun install` and `bun run check`; commit workspace/contracts.

## Task 2: Deterministic extraction and refusal tests

**Files:** `apps/api/src/pdf.ts`, `apps/api/src/extract.ts`, `apps/api/src/extract.test.ts`.

**Interface:** `extractPdfPages(buffer)` produces 1-based positioned tokens; `extractDocument(buffer)` returns `{ items, refusals }`; `classifyRows(rows)` can be unit tested with positioned fixtures.

- [x] Adapt positioned PDF.js extraction and row grouping, preserving original token text while filtering whitespace for classification.
- [x] Add Bun refusal tests for missing/invalid quantities, missing totals, unsupported evidence, contradictory arithmetic, readable refusal messages, 1-based evidence, and partial success.
- [x] Detect table columns from headers. Parse candidate fields from their own tokens, require source evidence, validate arithmetic without replacing sourced values, and ignore unrelated metadata.
- [x] Add document-level refusals for unreadable pages and conflicting summary data; skip summary/returns/credit/acceptance pages to avoid double counting.
- [x] Run `bun test` against fixtures and the available adjacent sample PDF; commit extraction.

## Task 3: Persistent asynchronous API

**Files:** `apps/api/src/db.ts`, `apps/api/src/worker.ts`, `apps/api/src/index.ts`, `apps/api/src/api.test.ts`.

**Interface:** upload responds `202 { id, status: "queued" }`; polling returns discriminated `DocumentResponse`. Worker claims queued row with conditional SQLite update, persists final result or failure.

- [x] Add SQLite document storage and local DB initialization. Validate multipart file, PDF signature, and size; save under `data/uploads/<uuid>.pdf`.
- [x] Insert queued row, return before processing, start a background worker loop, recover processing rows on restart, and expose GET states and useful error messages.
- [x] Exercise a sample through upload, queued/processing, persisted completion, provenance and refusals. Run tests and type check; commit backend.

## Task 4: Minimal web UI

**Files:** `apps/web/*`.

**Interface:** native PDF input posts to API then navigates to `/documents/:id`; TanStack Query polls GET about every second until completed/failed.

- [x] After Task 3 passed, create the Vite React app and add routing and polling dependencies.
- [x] Build upload and document routes with explicit queue/progress/error states, visible source evidence, and plain-language refusals.
- [x] Keep responsive single-column styling and accessible labels/focus. Build and type check; commit UI.

## Task 5: End-to-end and handoff

**Files:** `README.md`, any defects found in prior tasks.

- [x] Run refusal tests, type checks, lint, and builds. A UI upload of KBS-10270 was completed separately; API integration also exercised the available sample through processing and persisted result.
- [x] Document setup, data flow, polling/local storage choices, hardest decision, uncertainty, and three-day improvements. State unsupported layouts and OCR absence honestly.
- [x] Review tracked changes, confirm `../test/` is untouched, and commit final docs.
