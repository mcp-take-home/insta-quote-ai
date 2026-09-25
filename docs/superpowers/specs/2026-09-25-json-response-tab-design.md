# JSON Response Tab Design

## Goal

Let reviewers inspect and export the completed JSON response for an uploaded document.

## Design

Add tabs to the completed document view: **Extracted items** and **JSON response**. The JSON tab displays the exact completed API response, including `id`, `status`, optional `pageCount`, `items`, `details`, and `notes`, formatted with two-space indentation. Place **Copy JSON** and **Download JSON** controls in that tab. Copy reports success or failure accessibly. Download uses `document-{id}.json`.

Show tabs only after processing completes. Keep queued, processing, and failed states as they are. Use browser clipboard and Blob download APIs; add no dependencies.

## Acceptance

- Completed documents expose both tabs; extracted items remain the initial view.
- JSON tab shows the complete response object as readable, selectable JSON.
- Copy writes the same JSON text shown in the tab and provides status feedback.
- Download saves the same JSON text as `document-{id}.json` with JSON MIME type.
- Queued, processing, and failed views expose no JSON export controls.
- Type check, build, and UI verification pass.
