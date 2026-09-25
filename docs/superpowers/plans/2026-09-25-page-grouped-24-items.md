# Page-Grouped 24 Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development task-by-task. Steps use checkbox syntax.

**Goal:** Return every text-extractable `KBS-DR118` row as an item and show results by page. Image-only page produces no item data.

**Architecture:** Reuse existing text-row classifier on every page with selectable PDF text. No OCR. Keep API schema and group results in React.

**Tech Stack:** Bun, TypeScript, PDF.js, React.

## Global Constraints

- Work only in this repository; keep sample PDFs in `data/` and do not modify the sibling test project.
- No page-type exclusion for item tables.
- Every number needs page and exact available source text; no guessed numeric fields.
- Uncertain rows remain in `items` with plain-language `error` for red table display.
- Keep `items`, `details`, `notes` API shape; preserve valid rows when another page is unreadable.
- Image-only pages receive unreadable-page notes and no inferred values.
- Run focused Bun tests, `bun run check`, and all-six sample API validation.

---

### Task 1: Text extraction and all-page item extraction

**Files:** Modify `apps/api/src/pdf.ts`, `apps/api/src/extract.ts`, `apps/api/src/extract.test.ts`, `apps/api/package.json`, `bun.lock` as needed. Create at most one small OCR helper if needed.

**Interface:** `extractDocument(ArrayBuffer)` still returns `{items, details, notes}`. Page grouping uses `evidence.page`.

- [ ] Capture RED tests: DR118 requires 21 items, three on pages 1–3 and 5–8, no page 4 items, and one unreadable-page note. KBS-10241 image page requires zero items and one unreadable-page note. Keep four other sample counts/behavior and parse all six through `DocumentResponseSchema`.
- [ ] Remove `excludedPage` logic; classify all readable pages identically.
- [ ] Keep textless PDF pages empty and preserve unreadable-page notes.
- [ ] Run focused tests, API checks, all-six sample extraction; commit backend deliverable only.

### Task 2: Page-grouped result view and documentation

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/App.css`, `README.md`, `docs/design.md`, `docs/implementation-plan.md`.

**Interface:** Consume unchanged `DocumentResponse` schema. Group by `item.evidence.page` and note location; do not infer page count from item count.

- [ ] Show an extracted-items table per source page, including refused rows in that table with existing red style and inline error. Show page heading and item count. Group page-located notes with the page; keep document-wide notes visible.
- [ ] Keep dynamic details and their first-source evidence. No separate refusals section.
- [ ] Update docs to explain text-based all-page classification, image-only page limits, and page grouping. Remove page-type exclusions.
- [ ] Run web check, lint/build, browser smoke for DR118 and KBS-10255; commit.

### Review

- [ ] Review each task for spec compliance and code quality, fix actionable findings.
- [ ] Direct API upload/process all six PDFs; check exact per-page counts and errors.
- [ ] Final branch review and clean working tree.
