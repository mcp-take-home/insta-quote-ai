# Page-grouped extraction correction

## Observed source

`KBS-DR118.pdf` has eight pages with three visible table rows each: 24 rows total. Pages 1–3 and 5–8 have extractable text. Page 4 is an image with three visible rows and zero PDF text tokens. Current API returns nine `items`, twelve contextual rows in `notes`, and one unreadable-page note. User requires all table rows in `items` regardless of page heading, with refused rows red in table and results displayed by page.

## Options

1. **Recommended:** Parse every text page the same way; OCR only pages without a text layer. Add OCR-detected item rows to `items` with row/page evidence and an error, leaving uncertain numeric fields empty. Group API result client-side by page. This reaches 24 visible rows without trusting OCR numbers.
2. Show a single refused placeholder for an image-only page. No OCR dependency, but reports 22 rows rather than 24 and hides individual source rows.
3. Accept OCR numbers as ordinary numeric fields. More output, but risks confident wrong values and violates refusal rule when OCR misreads a digit.

## Design

Keep `items`, `details`, and `notes` response shape. Remove page-heading exclusion from text extraction. All identified table rows flow through `classifyRows`, including summary, returns, credit, and acceptance. Preserve existing arithmetic checks. For a page with no PDF text, render it and use local OCR only to identify numbered table rows and their descriptions. Emit each as an error-bearing item with page, reconstructed line, OCR source text, and no trusted quantity or money values. If OCR finds no rows, retain unreadable-page error note. Keep sample and application usable without a network request at processing time by using installed OCR assets.

Web result groups items by `evidence.page`, rendering a separate extracted-items table per page. Error-bearing rows keep existing red table styling and inline message. Group notes by page when page evidence exists. Keep document-wide details in the existing details view. Do not classify page type as accepted/refused.

## Acceptance

- `KBS-DR118`: 24 items, three per page; page 4 has three red refused OCR rows; other 21 rows are evaluated by normal table rules. No contextual-row refusal notes.
- `KBS-10241`: scanned page yields four red refused item rows if OCR can read them; otherwise unreadable-page note remains, without invented numeric fields.
- Other four samples retain their existing row counts and refusal behavior.
- All six PDFs pass direct upload, worker, API response validation; browser shows page sections and inline red errors.
