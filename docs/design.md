# PDF quote extraction design

## Scope and choice

The assessment needs trustworthy extraction and a readable result. Three possible approaches were considered: (1) flatten page text and match rows with regular expressions, (2) use PDF.js positioned tokens and deterministic table columns, (3) ask a model to interpret each page. Choose (2): it reuses the supplied prototype, preserves page and token evidence, and makes refusals explainable. It intentionally supports a narrow class of text-layer tables instead of guessing across layouts.

## Data flow

`POST /api/docs` validates a PDF, saves it under local `data/uploads`, and inserts a queued SQLite document. A loop in the API process atomically claims one queued document, parses outside the request, and stores `completed` with items/refusals or `failed` with a clear processing error. `GET /api/docs/:id` exposes current state. The React app uploads and polls until terminal status.

## Extraction boundary

Adapt `test/utils/pdf.ts` without changing `test/`. Process each page independently. Group positioned tokens into rows, find an `Item / Description / Qty / Unit Price` table header, derive column boundaries, then classify candidate rows. An item requires explicit valid quantity and unit price; line total is required when the header contains that column. Numeric values carry the exact token text and 1-based PDF page. Validate source text and arithmetic; never synthesize a missing value. An unsafe row becomes a plain-language refusal, while adjacent valid rows survive. A page without readable text becomes a refusal. Relevant contradictions in page notes or document totals become refusals. Summary, return, credit, and acceptance pages are treated cautiously to avoid double counting delivery lines.

## Interface

Two small routes: upload and document result. Upload, queued, processing, failed, completed, items, and refusals each have explicit copy. Completed results show quantity, price, total, and their page/source evidence. Refusals remain visible beside successful items. Single-column layout, accessible labels, native file input, restrained visual style.

## Checks and limits

Use Bun tests for unsupported evidence, malformed numbers, contradictions, missing totals, partial success, and 1-based provenance. Exercise upload, asynchronous status transition, persisted result, and polling with sample PDFs. No OCR: scanned pages report unreadable content. Layout support remains intentionally narrow and documented in README.
