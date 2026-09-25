# Page-grouped extraction correction

## Observed source

`KBS-DR118.pdf` has eight pages with three visible table rows each: 24 visual rows. Pages 1–3 and 5–8 have extractable text, yielding 21 text-based items. Page 4 is an image with zero PDF text tokens. OCR is out of scope; page 4 yields no extracted values and one unreadable-page note. Pages 5–8 remain ordinary item tables regardless of heading.

## Options

1. **Chosen:** Parse available PDF text on every page the same way. Image-only pages yield no extracted values and an unreadable-page note. Group API result client-side by page.

## Design

Keep `items`, `details`, and `notes` response shape. Remove page-heading exclusion from text extraction. All text-based table rows flow through `classifyRows`, including summary, returns, credit, and acceptance. Preserve existing arithmetic checks. Pages without extractable PDF text receive an unreadable-page note and no inferred values.

Web result groups items by `evidence.page`, rendering a separate extracted-items table per page. Error-bearing rows keep existing red table styling and inline message. Group notes by page when page evidence exists. Keep document-wide details in the existing details view. Do not classify page type as accepted/refused.

## Acceptance

- `KBS-DR118`: 21 items: three on pages 1–3 and 5–8; page 4 has no items and one unreadable-page note. No contextual-row refusal notes.
- `KBS-10241`: scanned page yields no items and one unreadable-page note.
- Other four samples retain their existing row counts and refusal behavior.
- All six PDFs pass direct upload, worker, API response validation; browser shows page sections and inline red errors.
