# PDF quote extraction design

## Architecture

The Bun workspace contains a Hono API, a React/Vite client, and a shared Zod contract. The API accepts PDFs at `POST /api/docs`, writes each file under local `data/uploads`, and inserts a queued row into SQLite. An in-process worker claims queued rows with Drizzle, extracts the PDF, and saves a completed result or processing error. `GET /api/docs/:id` returns queued, processing, completed, or failed state. The client polls until completion or failure.

`apps/api/src/schema.ts` defines the Drizzle table. `apps/api/drizzle.config.ts` points Drizzle Kit at that schema, and checked-in migrations under `apps/api/drizzle/` are applied by `apps/api/src/db.ts` when the database opens. Queries and updates use Drizzle ORM. `GET /api/openapi.json` serves the API description and `GET /api/reference` serves its Scalar reference.

## Extraction and evidence

PDF.js reads positioned text tokens page by page. Tokens are grouped into 1-based visible text rows, then table columns are identified from a header and candidate rows are classified using their token positions. Numeric fields retain the exact PDF token text as `evidence.sourceText`, along with 1-based page and line references; row context is retained where useful. Extracted values are not synthesized: missing, ambiguous, invalid, or contradictory item values produce an inline item error, while document-level issues produce a note with an inline error and available source location.

Completed results contain `items`, dynamic `details`, and `notes`. A `Label: value` row contributes a sourced text value under that label in `details`; repeated labels keep multiple values. Other non-table text becomes a note. Item and note errors stay attached to the affected entry; there is no separate refusal collection. Readable summary, returns, credit, and acceptance pages are skipped for item counting and explained in notes. Pallet-count conflicts and document-total contradictions are also reported as notes. A multi-page total with unclear scope is marked unverifiable.

## API and interface

Uploads are limited to 15 MB and checked for multipart input, a PDF filename or content type, and the `%PDF-` signature. The API returns `202` with the queued document ID before extraction runs. The browser uses a native file input, uploads multipart data, then polls the document route about once per second. The result view shows sourced details, notes, item values, per-field source text, and inline errors.

## Limits

Extraction relies on a readable PDF text layer; there is no OCR. It expects a recognizable item, description, quantity, unit-price, and line-total table. Unusual layouts, wrapped descriptions, or unclear page-total scope can produce errors or notes instead of inferred values. Storage and the worker are local to the API process. There is no backward-compatibility layer for older result shapes; the shared Zod schema is the current response contract.
