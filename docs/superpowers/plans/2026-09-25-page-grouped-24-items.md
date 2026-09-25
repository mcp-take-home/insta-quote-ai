# Page-Grouped 24 Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development task-by-task. Steps use checkbox syntax.

**Goal:** Return all 24 `KBS-DR118` table rows as `items` and show results by page.

**Architecture:** Reuse existing text-row classifier on every readable page. Add OCR fallback only for textless pages; mark OCR row values uncertain. Keep API schema and group result in React.

**Tech Stack:** Bun, TypeScript, PDF.js, Tesseract.js, React.

## Global Constraints

- Work only in `submission/`; do not modify sibling `data/` or `test/`.
- No page-type exclusion for item tables.
- Every number needs page and exact available source text; no guessed numeric fields.
- Uncertain rows remain in `items` with plain-language `error` for red table display.
- Keep `items`, `details`, `notes` API shape; preserve valid rows when another page is unreadable.
- Add dependencies with `bun add`; keep OCR local after install.
- Run focused Bun tests, `bun run check`, and all-six sample API validation.

---

### Task 1: OCR fallback and all-page item extraction

**Files:** Modify `apps/api/src/pdf.ts`, `apps/api/src/extract.ts`, `apps/api/src/extract.test.ts`, `apps/api/package.json`, `bun.lock` as needed. Create at most one small OCR helper if needed.

**Interface:** `extractDocument(ArrayBuffer)` still returns `{items, details, notes}`. OCR items use existing `ExtractedItem` with `error`, without quantity/unitPrice/lineTotal. Page grouping uses `evidence.page`.

- [ ] Capture RED tests: DR118 requires exactly 24 items, three on each page, page 4 three error-bearing rows, pages 5–8 in items and no page-type refusal notes. KBS-10241 image page requires four error-bearing rows if OCR identifies them. Keep four other sample counts/behavior and parse all six through `DocumentResponseSchema`.
- [ ] Test OCR feasibility on sample page 4 before committing implementation; if local model/rendering cannot identify three rows, escalate with evidence rather than fabricate rows.
- [ ] Remove `excludedPage` logic; classify all readable pages identically.
- [ ] Render only textless PDF pages and run local OCR; identify numbered table lines by position/text. Include source/page/line evidence and plain-language error; omit uncertain numeric values. Preserve unreadable note if no rows found. No OCR on text pages.
- [ ] Run focused tests, API checks, all-six sample extraction; commit backend deliverable only.

### Task 2: Page-grouped result view and documentation

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/App.css`, `README.md`, `docs/design.md`, `docs/implementation-plan.md`.

**Interface:** Consume unchanged `DocumentResponse` schema. Group by `item.evidence.page` and note location; do not infer page count from item count.

- [ ] Show an extracted-items table per source page, including refused rows in that table with existing red style and inline error. Show page heading and item count. Group page-located notes with the page; keep document-wide notes visible.
- [ ] Keep dynamic details and their first-source evidence. No separate refusals section.
- [ ] Update docs to explain all-page classification, OCR fallback/uncertainty, and page grouping. Remove now-wrong excluded-page claims.
- [ ] Run web check, lint/build, browser smoke for DR118 and KBS-10255; commit.

### Review

- [ ] Review each task for spec compliance and code quality, fix actionable findings.
- [ ] Direct API upload/process all six PDFs; check exact per-page counts and errors.
- [ ] Final branch review and clean working tree.
