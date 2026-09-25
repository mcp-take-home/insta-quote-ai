# Sample extraction fixes

## Findings

All six supplied PDFs were run through `extractDocument`. On `KBS-DR118`, pages 5–8 each contain three table rows. `extractDocument` classifies them, then discards them because those pages are summary, returns, credit, or acceptance pages. Only page-level notes remain, so no refused rows reach red item styling. The same file repeats `Document No`, `Date`, company heading, and page counters across pages; `extractDetails` emits each occurrence.

Other samples: `KBS-10255` has four item rows with `MISSING_LINE_TOTAL`; `KBS-10241` has no text layer and returns an unreadable-content note; `KBS-10270` has a document-total contradiction note; `KBS-10262` has a pallet-count conflict note. These refusal paths already carry errors.

## Approaches

1. **Recommended: preserve excluded rows as refused items; deduplicate repeated document metadata.** Keep one row per source line with an inline error and no trusted numeric amounts. Retain one copy of identical detail and note text with its first source. Keep distinct values and site headings.
2. Show all excluded rows as ordinary items with a page warning. Smaller parser change, but duplicates appear usable and numeric amounts can be mistaken for accepted values.
3. Hide excluded rows and improve page notes. Less screen content, but does not meet requirement that refused rows appear highlighted with individual errors.

## Design

For excluded pages, reuse `classifyRows` to identify table rows, then emit each identified row as an `ExtractedItem` with `error` explaining its page context. Preserve description and row evidence; omit extracted numeric fields so those values cannot be counted as accepted. Keep page-level note for context and unreadable-page note when no text exists. Shared schema and UI already display error-bearing items in red.

For repeated metadata, `extractDetails` keeps first occurrence of an identical label/value pair and first identical plain note. Different values under one label remain separate. Drop `Page N of M` markers from notes as pagination, not document content. Retain distinct site headings and error notes. Deduplication applies to extracted output, not PDF source.

## Checks

Add failing sample assertions before fixes: `KBS-DR118` must return nine accepted and twelve refused rows, each refused row with page and line evidence plus plain-language error; repeated document number/date appear once; different site headings remain. Run all six samples through extraction and response-schema validation, focused tests, type checks, build, and UI review of red rows.
