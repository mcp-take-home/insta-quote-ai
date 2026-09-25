# Insta Quote AI

A small PDF quote review app. It extracts document details and line items tied to source text, and marks uncertain values with plain-language errors.

## Run locally

Requires Bun. From this directory:

```sh
bun install
bun run --filter @insta-quote/api dev
```

In a second terminal:

```sh
bun run --filter web dev
```

Open [http://localhost:5173](http://localhost:5173). The API listens on port 3000; Vite forwards `/api` requests to it. The API creates `data/documents.sqlite` and `data/uploads/` on first run. It applies checked-in Drizzle migrations when the database opens. The supplied sample PDFs live in the sibling `../data/` directory. The sample API integration test uses `../data/KBS-10270.pdf` and skips itself if that file is absent. API reference: [http://localhost:3000/api/reference](http://localhost:3000/api/reference).

## How it works

`PDF upload → local file → SQLite document queue → background worker → positioned PDF text parsing → evidence and error checks → persisted result → browser polling`

The upload endpoint saves the file and queued record, then returns `202` without parsing it in the request. A worker in the API process claims queued records through Drizzle, reads each PDF, and persists either a completed result or a processing failure. The web app polls the document endpoint about once a second and stops when it reaches a terminal state. Document labels become keys in `details`; identical label/value pairs and plain note text keep their first sourced occurrence, while distinct values remain. Page counters are omitted. Rows on summary, returns, credit, and acceptance pages appear as sourced error notes, not delivery items. Other errors sit on the affected item or note, without a separate refusal list. Page and line references use 1-based numbering; a line is one reconstructed visible text row on that PDF page, including separator rows.

Files and SQLite keep the assessment easy to run without external services. They are local to this checkout and are not shared or durable across machines; a deployed service would use shared durable file storage and a production queue/database. The UI uses Rux with the shared response schema for JSON polling. Upload uses native `fetch` because that request must send `multipart/form-data`, while the configured Rux endpoint body is JSON-oriented.

## Hardest decision

The hardest decision was where to draw the extraction boundary. I chose deterministic parsing of positioned PDF.js text tokens and explicit errors when a row cannot be verified. That keeps page and source text attached to every extracted number, allows a bad row to coexist with valid rows, and avoids turning a plausible guess into a quote value. Arithmetic checks already sourced values; it does not fill in a missing line total.

## Where I am not confident

The parser expects a readable PDF text layer and a recognizable `Item / Description / Qty / Unit Price` table with a line total column. It uses token positions and a small row-coordinate tolerance, so unusual column layouts, overlapping or malformed text, and wrapped multi-line descriptions can be misclassified or marked uncertain. It does not do OCR, and the supplied sample API integration test skips when `../data/KBS-10270.pdf` is unavailable. I verified the provided KBS-10270 example in the UI; that does not establish accuracy on other suppliers' layouts.

## With three more days

I would add focused fixtures for more supplier layouts and wrapped rows, improve table-boundary detection while preserving token-level evidence, and test the full upload-to-poll flow against each supplied sample. I would also make evidence easier to inspect in the original PDF and add basic worker failure/retry visibility before considering shared storage or a production queue.

## Checks

Run the project checks from this directory:

```sh
bun test
bun run check
bun run build
bun run --filter web lint
```
