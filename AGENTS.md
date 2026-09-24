# Repository instructions

- Work only in this repository. Keep sample files in `../data/` and never edit `../test/`.
- Use Bun workspaces and the existing package scripts. Add dependencies with `bun add`.
- Use `@nghien-ot/rux` for external API calls. Keep the required multipart upload on native `fetch` until Rux supports `FormData` bodies.
- Keep PDF extraction deterministic. Every emitted number needs exact source text and a 1-based page; refuse uncertain values in plain language.
- Preserve successful rows when another row or page is unreadable.
- Run `bun run check` after implementation changes and focused Bun tests for extraction/API behavior.
- Keep `CLAUDE.md` as a symlink to this file.
