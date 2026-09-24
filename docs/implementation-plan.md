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

- [ ] Use `bun init -y` for root; `bun create hono@latest apps/api --template bun` for API; `bun add -d turbo@latest` and `bun add` commands for dependencies. Do not scaffold web yet. Create minimal shared package through `bun init -y` in `packages/shared`.
- [ ] Set Bun workspaces to `apps/*`, `packages/*`; add Turbo `dev`, `build`, `check`, `test` tasks. Create short agent instructions and symlink.
- [ ] Define Zod evidence and response schemas: every numeric item field requires `{ value, evidence: { page, sourceText, contextText? } }`; status discriminant distinguishes queued, processing, completed, failed.
- [ ] Run `bun install` and `bun run check`; commit workspace/contracts.

## Task 2: Deterministic extraction and refusal tests

**Files:** `apps/api/src/pdf.ts`, `apps/api/src/extract.ts`, `apps/api/src/extract.test.ts`.

**Interface:** `extractPdfPages(buffer)` produces 1-based positioned tokens; `extractDocument(buffer)` returns `{ items, refusals }`; `classifyRows(rows)` can be unit tested with positioned fixtures.

- [ ] Adapt `../test/utils/pdf.ts` page extraction and row grouping, preserving original token text while filtering whitespace for classification.
- [ ] Write Bun tests first for missing/invalid quantity, missing line total, unsupported source evidence, contradictory arithmetic, readable refusal messages, 1-based evidence, and valid rows surviving rejected rows.
- [ ] Detect table columns from headers. Parse each candidate row field from its own token. Require exact numeric syntax and source evidence. Validate `quantity × unitPrice` against sourced line total without replacing it. Ignore unrelated metadata.
- [ ] Add document-level refusals for unreadable pages and conflicting summary data. Avoid double counting summary/returns/credit/acceptance pages; explain skipped relevant rows.
- [ ] Run `bun test` against fixtures and sample PDFs; commit extraction.

## Task 3: Persistent asynchronous API

**Files:** `apps/api/src/db.ts`, `apps/api/src/worker.ts`, `apps/api/src/index.ts`, `apps/api/src/api.test.ts`.

**Interface:** upload responds `202 { id, status: "queued" }`; polling returns discriminated `DocumentResponse`. Worker claims queued row with conditional SQLite update, persists final result or failure.

- [ ] Add Drizzle SQLite table and local DB initialization. Validate multipart file, PDF signature, and size; save under `data/uploads/<uuid>.pdf`.
- [ ] Insert queued row, return before processing, start short background polling loop, and recover processing rows on restart. Expose GET states and useful error messages.
- [ ] Exercise a sample through upload, queued/processing, persisted completion, provenance and refusals. Run tests and type check; commit backend.

## Task 4: Minimal web UI

**Files:** `apps/web/*`.

**Interface:** native PDF input posts to API then navigates to `/documents/:id`; TanStack Query polls GET about every second until completed/failed.

- [ ] Only after Task 3 passes, run `bun create vite@latest apps/web --template react-ts`, add React Router and TanStack Query using Bun CLI, and use Impeccable Operate guidance.
- [ ] Build upload route and document route. Show queued/processing text, useful upload or processing errors, each sourced value with visible page and source text, and all refusals with plain messages and context.
- [ ] Keep responsive single-column CSS, accessible labels/focus, and restrained styling. Build and type check; commit UI.

## Task 5: End-to-end and handoff

**Files:** `README.md`, any defects found in prior tasks.

- [ ] Run all refusal tests, type checks, and builds. Upload sample PDFs through frontend, poll through completed, inspect evidence, partial success, and legible refusals.
- [ ] Document setup, data flow, polling/local storage choices, hardest decision, uncertainty, and three-day improvements. State unsupported layouts and OCR absence honestly.
- [ ] Review all tracked files live solely in `submission/`, confirm `../test/` untouched, and commit fixes/docs.
