# src/shared

Types and pure code used by more than one process.

- `ipc.ts` - the IPC contract: every channel name and its signature.
- `indexer-protocol.ts`, `embedder-protocol.ts` - main ⇄ worker messages.
- `vault.ts`, `ai.ts`, `archive.ts`, `obsidian-sync.ts`, `index-results.ts`, `topics.ts` - the types
  the contract carries, and small helpers over them (vault paths, hidden names, tree sort).
- `parse.ts` (notes: frontmatter, headings, links, tags; link resolution), `frontmatter.ts` (editing
  frontmatter without losing what it does not understand), `link-property.ts`, `templates.ts`,
  `vectors.ts`, `score.ts`.

**Rules for this folder:** it imports nothing outside itself, and nothing that only one process has -
no `electron`, no `node:` modules, no DOM - because the renderer, main and the workers all load it.
Anything here can be imported from anywhere in `src/`.
