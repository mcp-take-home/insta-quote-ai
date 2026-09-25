# Task 1 report: refused rows on excluded pages

## RED

Command: `bun test apps/api/src/extract.test.ts`

Result: failed as expected at the new KBS-DR118 assertion: expected 21 extracted items, received 9. Existing assertions passed up to that point.

## GREEN

Command: `bun test apps/api/src/extract.test.ts`

Result: passed — 11 tests, 0 failures, 59 assertions. PDF.js emitted its existing `standardFontDataUrl` warnings while loading sample PDFs.

Command: `bun run check`

Result: passed — all 3 workspace packages (`@insta-quote/shared`, `@insta-quote/api`, `web`) completed successfully.

Command: `git diff --check`

Result: passed; Git printed line-ending conversion warnings for the two edited TypeScript files.

## Files

- `apps/api/src/extract.ts`: classify excluded-page rows once, retain table-line exclusions, and append refused copies with descriptions and row evidence but without numeric fields.
- `apps/api/src/extract.test.ts`: assert KBS-DR118 keeps 9 accepted rows, exposes 12 refused rows from pages 5–8, and preserves description/evidence while omitting numeric values.

## Concerns

No known functional concerns. The sample test still emits PDF.js font data warnings; they do not fail extraction or checks.
