# src/workers

The two utility processes main starts, so heavy work never blocks the window.

- `indexer/` - the SQLite index in `.recto/index.db`: schema and migrations (`migrations.ts`), the
  connection (`db.ts`), parsing notes in (`index.ts`), the read queries (`queries.ts`) and version
  history (`snapshots.ts`). A cache of the vault; see `docs/ARCHITECTURE.md`.
- `embedder/` - the local EmbeddingGemma model: turns note text into vectors for topics.

Each talks to main with typed messages from `shared/indexer-protocol.ts` and
`shared/embedder-protocol.ts`.

**Must not be imported from here:** main starts these by file path and talks to them by message;
nothing imports their modules. They import only `shared/` and their own npm packages - never
`electron`, `main/` or `renderer/`.
