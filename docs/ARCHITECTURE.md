# Architecture

Recto is an Electron app over a folder of markdown files. The files are the truth; everything else
- the search index, the graph, topics, version history - is derived from them or kept beside them.

## Processes

```
                         ┌───────────────────────────────┐
                         │ renderer (React, no Node)     │
                         │  app/ shell · features/ · ui/ │
                         │  graph physics: Web Worker    │
                         └──────────────┬────────────────┘
                                        │ window.api.invoke / .on
                         ┌──────────────┴────────────────┐
                         │ preload                       │
                         │  allow-listed channels only   │
                         └──────────────┬────────────────┘
                                        │ ipcRenderer ⇄ ipcMain
┌───────────────────────────────────────┴──────────────────────────────────────────┐
│ main (Node)                                                                      │
│  vault, files, watcher, rename + link rewrite, archive, Obsidian sync, AI,       │
│  secrets, topics service, window and navigation policy, recto-file:// scheme     │
└───────────────┬───────────────────────────────────────────┬──────────────────────┘
                │ utilityProcess, parentPort messages         │ utilityProcess
┌───────────────┴───────────────────┐            ┌────────────┴──────────────────────┐
│ indexer (workers/indexer)         │            │ embedder (workers/embedder)        │
│  better-sqlite3: .recto/index.db  │            │  EmbeddingGemma, local, ONNX       │
│  parse, FTS5 search, links, graph │            │  note vectors for topics           │
│  boards, version history          │            │  (tables in the same index.db)     │
└───────────────────────────────────┘            └────────────────────────────────────┘
```

- **main** owns the disk and every side effect. `src/main/index.ts` starts it; `ipc.ts` registers one
  handler per channel.
- **preload** exposes a single object, `window.api`, with `invoke(channel, ...args)` and
  `on(channel, listener)`. It refuses any channel not in the contract and never hands the renderer
  the `IpcRendererEvent` (which carries `sender`).
- **renderer** has `contextIsolation: true` and `nodeIntegration: false`. It can only ask. Images
  load through `recto-file://vault/<path>`, which main resolves inside the vault or answers 403.
- **indexer** and **embedder** are utility processes so a first index of a large vault, or a model
  run, never blocks the window. Main talks to them with typed messages
  (`shared/indexer-protocol.ts`, `shared/embedder-protocol.ts`), one request id per message.
- The graph's force simulation is a Web Worker inside the renderer (`features/graph/simulation.worker.ts`);
  positions come back as a transferred buffer.

## What crosses IPC

All of it is declared in `src/shared/ipc.ts`: `IPC` (request/response, renderer → main) and
`IPC_EVENT` (pushes, main → renderer), each with its signature in `IpcApi` / `IpcEvents`. Code refers
to channels by constant (`IPC.fsRead`), never by string; the build fails if a channel and its
signature disagree.

| group | what |
|---|---|
| `app:` | startup state, platform, vibrancy and theme source, full screen, clipboard text |
| `vault:` | pick, open, close, switch, recent vaults; `vault:changed` pushes watcher batches |
| `fs:` | tree, read, write, create, rename, move, trash, reveal, import images / dropped bytes |
| `state:` | read and write one `.recto/<feature>.json` |
| `index:` | search, backlinks, stats, vault usage, link resolution, unresolved, graph, boards, context |
| `links:` | undo the link rewrite of a rename |
| `history:` | a note's stored versions, and restoring one |
| `archive:` | archive, list, restore, purge, retention |
| `ai:` | key status (never the key), test, send, cancel; `ai:delta` / `ai:done` / `ai:error` stream the reply |
| `obsidian:` | find vaults, preview, enable, disable, sync now; `obsidian:status` pushes |
| `topics:` | settings, status, list, rename, delete, rebuild, preview, undo; `topics:status` / `topics:run` push |
| `shell:` | open an external URL |

What does not cross: the API key (main uses it, the renderer gets a masked hint), absolute paths
outside the vault, and anything that would let the renderer touch the disk directly.

## A note, from disk to screen

1. **Disk.** A note is a `.md` file in the vault. Main's `vault-fs.ts` is the only writer: it writes
   to a temp file and renames it over the original, so a crash cannot truncate a note, and it skips
   writes of identical bytes so the mtime means something.
2. **Watcher.** `watcher.ts` (chokidar) sees every change, including other apps'. Changes are batched
   for 60 ms. The app's own writes are marked just before they happen (`markSelfWrite`), so they are
   indexed but not echoed back to the editor as an external edit.
3. **Index.** Each batch goes to the indexer as `note-changed`. It parses the note
   (`shared/parse.ts`: frontmatter, headings, wikilinks, tags, properties), updates `notes`, `links`,
   `tags`, `properties`, `headings` and the FTS table, stores a version snapshot, and re-resolves the
   links that could now point somewhere.
4. **Renderer.** The same batch is pushed as `vault:changed`. The tree applies it to its copy
   (`file-tree/file-tree-ops.ts`), `note-bus.ts` bumps a revision, and views that show derived data -
   backlinks, graph, boards, home statistics - ask the index again through `index:*`.
5. **Editor.** A note opens with `fs:read` into CodeMirror (`features/editor/codemirror.ts`). Typing
   is saved with `fs:write` after 500 ms of quiet, and on close. A change on disk from elsewhere is
   reloaded into the editor.
6. **Topics.** On a timer and when the window regains focus, the topics service in main reads the
   index's graph (`topics-graph`), has the embedder turn changed notes into vectors, clusters them,
   and writes `topics: [[topics/…]]` into the notes' frontmatter - through the same `vault-fs` path,
   as one undoable run.

## Where things live

```
src/main/        the main process (see its README)
src/preload/     the bridge
src/workers/     indexer and embedder processes
src/shared/      types and pure code more than one process uses
src/renderer/
  app/           the shell: workspace and tabs, sidebar, status bar, command palette, hotkeys,
                 stores (vault tree, appearance, note bus), view registry
  features/      one folder per feature, each with components/, hooks/, styles/ and an index.ts
                 that is its public entry and imports its CSS
  ui/            primitives with no feature knowledge: icons, tooltips, menus, dialogs, the
                 colour editor, sliders, toggle, setting row, chip styles, tints, the fuzzy
                 matcher and picker keys
  styles/        tokens, element rules, layout, motion
test/            the same folders as src/
```

| feature | what | CSS block(s) |
|---|---|---|
| `editor` | CodeMirror, live preview, properties, backlinks, outline, history, writing tools | `md`, `prop(s)`, `backlinks`, `outline`, `history`, `formatbar`, `focusbar`, `wmenu`, `note-title`, `link-suggest` |
| `file-tree` | the Data tree, drag and drop, context menu, note preview card | `tree`, `note-peek` |
| `search` | full-text search, quick switcher | `search-result` (inside the shared `palette`) |
| `graph` | the link graph and its settings panel | `graph`, `gset`, `gwheel`, `glegend` |
| `boards` | kanban boards over notes | `board`, `boards` |
| `topics` | topics settings and the run notice | `topics` |
| `tidy` | filing loose notes | `tidy` |
| `home` | the home overlay and statistics | `home` |
| `settings` | the settings dialog and its tabs | `settings`, `setting` notes, `osync`, `hotkeys`, `vault-recent`, `daily`, `note-error` |
| `ai` | chats with Claude, saved as notes | `chat` |
| `templates` | template picker, daily notes | (uses `palette`) |
| `archive` | archived notes | `archive` |
| `links` | unresolved links | `unresolved` |

Features import each other only through `index.ts`. The app shell imports features; features import
`app/` for the api, the note bus and the view registry, and `ui/` for primitives. `ui/` imports
neither `app/` nor any feature, and `shared/` imports nothing outside itself.

## On disk

In the vault:

| path | format | owner |
|---|---|---|
| `**/*.md` | markdown with optional YAML-ish frontmatter; unrecognised frontmatter is kept byte for byte | the user |
| `attachments/` | images pasted or dropped into notes | editor |
| `templates/`, `Daily/` (configurable) | ordinary notes | templates |
| `tasks/` | cards: notes whose frontmatter has `board`, `status`, `order` | boards |
| `chats/` | conversations: notes with `## You` / `## Claude` sections | ai |
| `.recto/<feature>.json` | one JSON file per feature: `appearance`, `workspace`, `graph`, `writing`, `templates`, `boards`, `hotkeys`, `tree-order`, `authors`, `topics`, `topics-settings`, `archive` | `main/state.ts` |
| `.recto/index.db` | SQLite (WAL): the index, version snapshots, usage events, topic vectors | indexer, embedder |
| `.recto/archive/` | archived files until retention runs out | `main/archive.ts` |
| `.recto/.gitignore` | keeps `index.db`, `.trash/` and `archive/` out of git | written once |

Topics are written into notes as `topics: ["[[topics/Name]]"]`; a topic has no file of its own.

Outside the vault, in the app-data folder (`~/Library/Application Support/Recto/`):
`app-state.json` (last and recent vaults), `secrets.bin` (the API key, encrypted with Electron
`safeStorage`), `obsidian-sync.json` and `obsidian-sync/` (pairings and sync manifests), `models/`
(the embedding model).

## Why the index is a cache

The files are what the user owns: they sync, go into git, open in other editors, and outlive this
app. If the index were the truth, every one of those would be a way to lose data. So every fact in
`index.db` is recomputed from the files - delete it and the next launch rebuilds it - and nothing a
user cares about may live only in SQLite. The two exceptions are recorded, not derived: version
snapshots and usage events. Losing them loses history, never notes, and the migrations, the parser
and the link resolver can all change freely because a rebuild is always safe.
