# Sample Extraction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Surface every refused sample row with inline error and remove repeated document data.

**Architecture:** Change existing extraction boundary only. Existing response schema, database JSON, and UI error-row styling carry result end to end.

**Tech Stack:** Bun, TypeScript, PDF.js, Zod, React.

## Global Constraints

- Work only in `submission/`; do not edit `../data/` or `../test/`.
- Preserve evidence: exact source text, 1-based page and line for rows and extracted numbers.
- Keep successful rows when another page or row is refused.
- No new dependency or response section.
- Follow existing `AGENTS.md`; run `bun run check` and focused Bun tests.

---

### Task 1: Refused rows on excluded pages

**Files:** Modify `apps/api/src/extract.ts`; test `apps/api/src/extract.test.ts`.

**Interface:** `extractDocument(buffer)` retains `{items, details, notes}` response. Error-bearing items already render red in `apps/web/src/App.tsx`.

- [ ] Add failing `KBS-DR118` assertion: pages 5–8 provide twelve refused item rows with descriptions and 1-based row evidence; pages 1–3 retain nine accepted rows. Every excluded item has plain-language `error`, no trusted numeric fields. Keep page context notes and page-4 unreadable note.
- [ ] Run `bun test apps/api/src/extract.test.ts`; record failing result.
- [ ] In excluded-page branch, classify table rows and append error-bearing copies of those rows to `items`, using page type in message; preserve description and row evidence, omit numeric fields. Keep table line exclusion for details. Avoid new parser or schema.
- [ ] Run focused test and `bun run check`; record results; commit.

### Task 2: Repeated metadata and sample audit

**Files:** Modify `apps/api/src/extract.ts`, `README.md`, `docs/design.md`, `docs/implementation-plan.md`; test `apps/api/src/extract.test.ts`.

**Interface:** `extractDetails(pages)` retains `{details, notes}`.

- [ ] Add failing `KBS-DR118` assertion: `Document No: KBS-DR118` and date appear once, company heading appears once, page counters do not appear in notes; distinct site headings remain. All six sample results parse with `DocumentResponseSchema`; document-specific refusal behavior remains.
- [ ] Run focused test; record failing result.
- [ ] In `extractDetails`, retain first evidence for identical label/value pairs and identical plain note text. Skip page-counter-only lines. Do not collapse distinct labels, values, or error notes.
- [ ] Update existing docs that claim repeated labels retain all values or excluded rows are only skipped. Run focused test, full `bun test`, `bun run check`, `bun run build`, and web lint; record results; commit.

### Task 3: PDF.js standard font data

**Files:** Modify `apps/api/src/pdf.ts`; test `apps/api/src/extract.test.ts`.

**Interface:** `extractPdfPages(buffer)` keeps same output. `pdfjs-dist` remains installed dependency.

- [ ] Reproduce `standardFontDataUrl` warnings when running extraction on the supplied PDFs; record baseline output.
- [ ] Supply PDF.js its installed `standard_fonts/` path through `getDocument` configuration. Resolve package location at runtime and keep path valid when API is built; use filesystem path with trailing slash, since installed Node font loader calls `fs.readFile` on it. Do not suppress warnings or add dependency.
- [ ] Run all six samples and verify text extraction is unchanged and font warnings disappear. Run focused test, `bun run check`, and API build; record results; commit.

### Review

- [ ] Review each task diff for spec compliance and code quality.
- [ ] Review full branch and verify sample outputs and UI styling.
