# Web app

Run with `bun run dev` from this directory. Vite forwards `/api` requests to `http://localhost:3000`.

Document polling uses Rux with the shared `DocumentResponseSchema`. Upload uses native `fetch` because the API requires multipart `FormData`, which Rux's endpoint bodies do not support.
