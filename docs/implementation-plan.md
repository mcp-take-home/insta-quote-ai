# PDF extraction implementation plan

> Implementation record: the milestones below are complete. The design document and source code define the current behavior.

## Goal and contract

Upload a quote PDF, process it asynchronously, and return line items with source evidence plus flexible document details and notes. The shared Zod schema defines queued, processing, completed, and failed responses. Completed responses contain `items`, `details`, and `notes`; extraction errors belong to the affected item or note. No backward-compatibility layer is provided for earlier response shapes.

Every trusted extracted numeric value carries exact source text, 1-based page, and reconstructed 1-based line. Preserve available row context. Do not infer missing numbers. Keep valid rows when another row is uncertain. Classify text-based table rows as items on every page. All other extractable text becomes page-sourced details: `Label: value` rows use their label and unlabeled rows use `Text`. Collapse identical values only within their page. Image-only pages receive unreadable-page notes and produce no extracted values; OCR is out of scope.

## Implemented milestones

1. **Workspace and contract:** Bun workspaces for the Hono API, React/Vite app, and shared Zod types.
2. **PDF extraction:** PDF.js positioned text, row grouping, header-based column detection, row arithmetic checks, inline item errors, and page-sourced details. Text-based pages are checked for item tables; image-only pages receive unreadable-page notes. Document-level reconciliation is omitted.
3. **Persistence and API:** `apps/api/src/schema.ts` defines the SQLite table. Drizzle Kit configuration and checked-in migrations live in `apps/api/drizzle.config.ts` and `apps/api/drizzle/`; `apps/api/src/db.ts` applies migrations and exposes the Drizzle database. Hono accepts PDFs up to 15 MB, validates the upload and PDF signature, stores local files and queued rows, then an in-process worker processes jobs. The API exposes upload and status routes, OpenAPI JSON, and a Scalar reference.
4. **Web client:** Native PDF upload, document status polling, and one items table plus one details section per source page. Error rows retain subtle highlighting and inline messages.
5. **Handoff documentation:** Setup, local data flow, parser limits, uncertainty, and follow-up work are documented in the README.

## Deliberate limits

The parser needs a recognizable item table with a line-total column. Image-only pages are not extracted. Ambiguous or unsupported row values remain errors rather than guesses. Files, SQLite, and the worker are local to one API process; shared storage and a production queue are future deployment work.
