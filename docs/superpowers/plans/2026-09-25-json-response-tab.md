# JSON Response Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users inspect, copy, and download completed document API responses from the result page.

**Architecture:** Keep one completed response object as source of truth. Add accessible tabs in the existing result page, with extracted items as the default panel and a formatted JSON panel containing copy/download controls. Use native browser clipboard, Blob, and anchor APIs without dependencies or server changes.

**Tech Stack:** React, TypeScript, CSS, browser Clipboard API, Blob URL download.

## Global Constraints

- Export the exact completed response object, including `id`, `status`, optional `pageCount`, `items`, `details`, and `notes`.
- Show tabs and export controls only for completed documents.
- Preserve extracted items as the initial view.
- Download as `document-{id}.json` with JSON MIME type.
- Report copy success or failure accessibly.
- Add no dependencies.

---

### Task 1: Add completed-response tabs and JSON actions

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Consumes: completed response from existing `useQuery`, typed as `CompletedDocument`.
- Produces: accessible **Extracted items** and **JSON response** tabs; exact formatted API response; copy status; downloaded `document-{id}.json`.

- [ ] **Step 1: Add tab state and JSON action handlers**

In `DocumentPage`, add:

```tsx
const [activeTab, setActiveTab] = useState<'items' | 'json'>('items')
const [copyStatus, setCopyStatus] = useState('')
const completed = document.data?.status === 'completed' ? document.data : undefined
const jsonText = completed ? JSON.stringify(completed, null, 2) : ''

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText)
    setCopyStatus('JSON copied.')
  } catch {
    setCopyStatus('Could not copy JSON. Select and copy it from this panel.')
  }
}

function downloadJson() {
  const url = URL.createObjectURL(new Blob([jsonText], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = `document-${id}.json`
  link.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 2: Render accessible panels only for completed responses**

Replace the completed-state body with:

```tsx
{completed && (
  <>
    <p className="complete-note" role="status">Review complete. Extracted items and page details are listed below.</p>
    <div className="result-tabs" role="tablist" aria-label="Document result">
      <button id="items-tab" role="tab" aria-selected={activeTab === 'items'} aria-controls="items-panel" onClick={() => setActiveTab('items')}>Extracted items</button>
      <button id="json-tab" role="tab" aria-selected={activeTab === 'json'} aria-controls="json-panel" onClick={() => setActiveTab('json')}>JSON response</button>
    </div>
    <section id="items-panel" role="tabpanel" aria-labelledby="items-tab" hidden={activeTab !== 'items'}>
      <PageGroupedItems document={completed} />
    </section>
    <section id="json-panel" role="tabpanel" aria-labelledby="json-tab" hidden={activeTab !== 'json'}>
      <div className="json-actions">
        <button type="button" onClick={copyJson}>Copy JSON</button>
        <button type="button" onClick={downloadJson}>Download JSON</button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{copyStatus}</p>
      <pre className="json-response"><code>{jsonText}</code></pre>
    </section>
  </>
)}
```

Keep queued, processing, and failed branches unchanged. Keep both panels mounted so tab state only changes visibility.

- [ ] **Step 3: Style tabs, actions, and JSON panel**

Add styles to `App.css` using existing palette, spacing, and focus rules:

```css
.result-tabs,
.json-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 20px 0 12px;
}

.result-tabs button[aria-selected='true'] {
  border-color: #315f50;
  background: #eaf1e9;
  color: #1c3933;
}

.json-response {
  max-height: 70vh;
  overflow: auto;
  padding: 16px;
  border: 1px solid #dce3dd;
  border-radius: 10px;
  background: #fffefa;
  color: #1c3933;
  font: 13px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre;
}
```

Add this visually-hidden status style:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 4: Run frontend checks**

Run `bun run check`, `bun run --filter web lint`, and `bun run build` from `submission/`. Expected: all pass.

- [ ] **Step 5: Verify in browser**

Start the API and web dev servers. Upload `data/KBS-10270.pdf`, wait for completion, and verify:

1. **Extracted items** opens first and continues to show the existing page-grouped table.
2. **JSON response** shows valid, formatted JSON with response `id`, `status`, `pageCount`, `items`, `details`, and `notes`.
3. **Copy JSON** writes the displayed JSON and announces success; if clipboard access fails, the panel reports failure and leaves the JSON selectable.
4. **Download JSON** saves a parseable `document-{id}.json` containing the same response.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.css
git commit -m "Add JSON response viewer and export controls"
```
