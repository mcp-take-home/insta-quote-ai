# PDF quote extraction design

## Architecture

The Bun workspace contains a Hono API, a React/Vite client, and a shared Zod contract. The API accepts PDFs at `POST /api/docs`, writes each file under local `data/uploads`, and inserts a queued row into SQLite. An in-process worker claims queued rows with Drizzle, extracts the PDF, and saves a completed result or processing error. `GET /api/docs/:id` returns queued, processing, completed, or failed state. The client polls until completion or failure.

`apps/api/src/schema.ts` defines the Drizzle table. `apps/api/drizzle.config.ts` points Drizzle Kit at that schema, and checked-in migrations under `apps/api/drizzle/` are applied by `apps/api/src/db.ts` when the database opens. Queries and updates use Drizzle ORM. `GET /api/openapi.json` serves the API description and `GET /api/reference` serves its Scalar reference.

## Extraction and evidence

PDF.js reads positioned text tokens page by page. Tokens are grouped into 1-based visible text rows, then table columns are identified from a header and candidate rows are classified using their token positions. Numeric fields retain the exact PDF token text as `evidence.sourceText`, along with 1-based page and line references; row context is retained where useful. Extracted values are not synthesized: missing, ambiguous, invalid, or contradictory item values produce an inline item error.

Completed results contain `items`, dynamic `details`, and `notes`. Text-based table rows become items on every page, regardless of heading. Every other extractable text row becomes a page-sourced detail: `Label: value` rows use their label, and unlabeled rows use `Text`. Identical values are collapsed only within the same page. Image-only pages produce no extracted data and receive an unreadable-page note; OCR is out of scope. `notes` is reserved for unreadable-page errors. Document-level total and pallet reconciliation is not performed.

## API and interface

Uploads are limited to 15 MB and checked for multipart input, a PDF filename or content type, and the `%PDF-` signature. The API returns `202` with the queued document ID before extraction runs. The browser uses a native file input, uploads multipart data, then polls the document route about once per second. New completed results include `pageCount`; the result view shows an items table and a details section for every source page, including pages without extracted content. Older saved results can omit `pageCount`. Error rows stay in their table with a pale highlight and inline message. Dynamic details, item values, and per-field source text remain visible.

## Limits

Extraction expects a recognizable item, description, quantity, unit-price, and line-total table. Image-only pages cannot be extracted. Unusual layouts and wrapped descriptions can produce row errors instead of inferred values. Storage and the worker are local to the API process. There is no backward-compatibility layer for older result shapes; the shared Zod schema is the current response contract.
