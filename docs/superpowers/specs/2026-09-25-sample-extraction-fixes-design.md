# Sample extraction fixes

## Findings

All six supplied PDFs were run through `extractDocument`. Visual inspection of every `KBS-DR118` page shows nine readable delivery rows on pages 1–3; page 4 is an image of three more delivery rows, so the parser cannot verify their values. Pages 5–8 each contain three table rows under summary, returns, credit, or acceptance headings. Those twelve contextual rows are not delivery items. The original extractor emits only page-level refusal notes for them, without row-level error or highlighting. An initial fix incorrectly added them as twelve `items`, inflating the API count to 21; this must be corrected. The file also repeats `Document No`, `Date`, company heading, and page counters across pages.

Other samples: `KBS-10255` has four item rows with `MISSING_LINE_TOTAL`; `KBS-10241` has no text layer and returns an unreadable-content note; `KBS-10270` has a document-total contradiction note; `KBS-10262` has a pallet-count conflict note. These refusal paths already carry errors.

Every sample currently logs PDF.js `standardFontDataUrl` warnings. PDF.js tries to load standard fonts while reading text. Installed font files are available, but `getDocument` receives no font directory. A direct test confirmed that a filesystem directory path with trailing slash loads them without warnings; a `file://` URL does not work with its Node loader.

## Approaches

1. **Recommended: preserve excluded rows as error notes; deduplicate repeated document metadata.** Keep nine readable delivery items. Add one highlighted refusal note per contextual table row, with row evidence and plain-language error. Retain one copy of identical detail and plain note text with its first source. Keep distinct site headings.
2. Show excluded rows as error-bearing items. Existing red item styling works, but item count becomes 21 and misrepresents twelve non-delivery rows.
3. Keep only page-level warnings. Fewer entries, but individual rows have no visible error and cannot be inspected.

## Design

For excluded pages, reuse `classifyRows` to identify table rows, then emit a `Note` per identified row with its description, row evidence, and an `error` explaining page context. Do not add them to `items`. Avoid duplicate page-level warning when row notes carry same reason. Preserve unreadable-page note for page 4; do not infer its three imaged rows. UI notes with errors receive red background/border and show error message beside source evidence. Existing `KBS-10255` item errors remain red.

For repeated metadata, `extractDetails` keeps first occurrence of an identical label/value pair and first identical plain note. Different values under one label remain separate. Drop `Page N of M` markers from notes as pagination, not document content. Retain distinct site headings and error notes. Deduplication applies to extracted output, not PDF source.

Configure existing PDF.js import with installed `standard_fonts/` path at runtime, including after bundle build. Leave text extraction behavior unchanged.

## Checks

Add failing sample assertions before fixes: `KBS-DR118` must return nine readable delivery items, twelve refusal notes for contextual table rows with page and line evidence, and one unreadable-page note for page 4; repeated document number/date appear once; different site headings remain. Run all six samples through extraction and response-schema validation, focused tests, type checks, build, and UI review of red errors.
