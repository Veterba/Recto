# src/main

The Electron main process: the only code that touches the disk, the network and the OS.

- `index.ts` - startup: single instance, dev isolation (`dev-guard.ts`), then the window.
- `window.ts`, `navigation.ts`, `vault-protocol.ts` - the window, where it may navigate, and the
  `recto-file://` scheme images load through.
- `ipc.ts` - one handler per channel in `shared/ipc.ts`; `events.ts` - typed pushes to the renderer.
- `vault.ts`, `vault-fs.ts`, `paths.ts`, `text-file.ts`, `watcher.ts` - opening a vault, every read
  and write (atomic, contained in the vault, text only), and watching it.
- `link-rewrite.ts` - rewriting links when a note is renamed or moved.
- `state.ts` (`.recto/<feature>.json`), `store.ts` (app-state in userData), `secrets.ts` (the API key, encrypted).
- `index-client.ts` - starts the indexer process and sends it requests.
- `archive.ts`, `sync/` (Obsidian), `ai/` (Claude), `topics/` (topics: the service, clustering, naming, the embedder client).
- `config.ts` - every `RECTO_*` environment variable.

**Must not be imported from here:** nothing outside `src/main` imports this folder. The renderer
reaches main only through IPC, the workers only through their message protocols, and `shared/`
knows nothing about it.
