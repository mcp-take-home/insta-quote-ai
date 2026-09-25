# PDF extraction implementation plan

> Implementation record: the milestones below are complete. The design document and source code define the current behavior.

## Goal and contract

Upload a quote PDF, process it asynchronously, and return line items with source evidence plus flexible document details and notes. The shared Zod schema defines queued, processing, completed, and failed responses. Completed responses contain `items`, `details`, and `notes`; extraction errors belong to the affected item or note. No backward-compatibility layer is provided for earlier response shapes.

Every extracted numeric value carries the exact PDF token text, 1-based page, and reconstructed 1-based line. Preserve available row context. Do not infer missing numbers. Keep valid rows when another row is uncertain. Dynamic `Label: value` rows become sourced entries in `details`; identical label/value pairs and identical plain note text keep their first evidence, while distinct values remain. Page-counter-only lines are omitted.

## Implemented milestones

1. **Workspace and contract:** Bun workspaces for the Hono API, React/Vite app, and shared Zod types.
2. **PDF extraction:** PDF.js positioned text, row grouping, header-based column detection, arithmetic checks, inline item errors, dynamic details, and sourced notes. Rows from summary, returns, credit, and acceptance pages become sourced error notes rather than delivery items; document-level conflicts are noted.
3. **Persistence and API:** `apps/api/src/schema.ts` defines the SQLite table. Drizzle Kit configuration and checked-in migrations live in `apps/api/drizzle.config.ts` and `apps/api/drizzle/`; `apps/api/src/db.ts` applies migrations and exposes the Drizzle database. Hono accepts PDFs up to 15 MB, validates the upload and PDF signature, stores local files and queued rows, then an in-process worker processes jobs. The API exposes upload and status routes, OpenAPI JSON, and a Scalar reference.
4. **Web client:** Native PDF upload, document status polling, and result views for sourced line items, details, notes, and inline errors.
5. **Handoff documentation:** Setup, local data flow, parser limits, uncertainty, and follow-up work are documented in the README.

## Deliberate limits

The parser needs a readable text layer and a recognizable item table with a line-total column. It does not perform OCR. Ambiguous or unsupported values remain errors or notes rather than guessed values. Files, SQLite, and the worker are local to one API process; shared storage and a production queue are future deployment work.
