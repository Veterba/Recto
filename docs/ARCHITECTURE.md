Architecture is just a file for people who want to understand how the project works under the hood.
People who would like to extend project or do something for Recto.

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
| `bots:` | list, model status, settings, send, cancel, retry, jobs, viewing, set model, title a chat topic; `bots:job` pushes every change to an answer, `bots:unread` and `bots:open-topic` (a notification clicked) |
| `obsidian:` | find vaults, preview, enable, disable, sync now; `obsidian:status` pushes |
| `topics:` | settings, status, list, rename, delete, rebuild, preview, undo; `topics:status` / `topics:run` push |
| `shell:` | open an external URL |

What does not cross: the API key (main uses it, the renderer gets a masked hint), absolute paths
outside the vault, and anything that would let the renderer touch the disk directly.

A bot's model runs in Ollama on `127.0.0.1:11434` by default (`main/bots/provider.ts`): its
question, the vault sections found for it, and the answer never leave the machine. Recto, the main
chat, can instead use an Anthropic model when a key is saved and that model is chosen in its picker;
then the same request goes to Anthropic over the app's own client. The vault search for a bot runs
in main, over the same index (`main/bots/context.ts`).

## How a bot answers

An answer is a **job owned by main** (`main/bots/jobs.ts`, `main/bots/answers.ts`), never by the chat
on screen. `bots:send` writes the question into the topic file and queues a job; one job runs at a
time across all topics (`queued → preparing → streaming → done | error | cancelled`, one `end()` exit,
a 60 s stall ends it). The answer is written into the topic as it streams (every second, tagged with
the job's id), so leaving the chat, switching topics or reloading the window loses nothing; on quit
it is saved and marked interrupted (Retry). Every change is pushed as `bots:job`; the chat, History
and the sidebar only watch (`renderer/features/bots/jobs-store.ts`). A finished answer out of sight
raises a notification.

Before the model writes a word, `main/bots/prepare.ts` works out what it needs:

1. **Router** (`router.ts`, `classify.ts`): rules first, then EmbeddingGemma against example
   questions per kind, then one short model call - `notes`, `tasks`, `recent`, `review`, `advice`,
   `smalltalk`, `self`, with a period worked out in code (`period.ts`).
2. **Names and scopes** (`resolve.ts`): notes the question names (fuzzy, by title and alias), and a
   folder, topic or the whole vault it is about. A named note that doesn't exist is said so, with the
   closest titles; another note is never read in its place.
3. **Task index**: tasks are rows in `index.db` (`tasks` table: checkboxes and items under a Tasks
   heading; cards from `board_items`, one row per card on a board note with its lane and stage),
   grouped back into one task when dailies copy them forward
   (`shared/tasks.ts`, `tools.ts`). A task list is written by the harness itself and shown as it is;
   the model adds one sentence. A project's tasks come from its notes in order of certainty -
   the topics property, a `project:` property, its folder and the notes linking to it
   (`scope-tools.ts` `projectNotes`) - and the model's guesses only as their own "Might belong here"
   group.
4. **Scope tools** for reviews and advice (`scope-tools.ts`): `vault_map`, `read_scope` (whole notes,
   or cards and outlines, or a map-reduce over cards for a big scope), `note_outline`,
   `structure_patterns`.
5. **Note cards** (`cards.ts`, `background.ts`): a short card per note (summary, language, kind,
   headings) written by the local model in the background, keyed by content hash and model
   (`note_cards` table).
6. **Retrieval** (`chunks.ts`, `vectors.ts`, `retrieve.ts`): notes cut into heading-sized pieces with
   their own vectors (`bot_chunks` table, written by the embedder), fused with FTS5 hits by
   reciprocal rank (k = 60); index notes are kept down, the last answers' pieces stay in reach.
7. **The prompt**: SYSTEM.md and the kind's example from EXAMPLES.md (both the user's to edit), then
   the runtime facts - today with its weekday, the model and where it runs, the vault's note count
   (never written into SYSTEM.md) - then what the steps found. Small talk and questions about Recto
   get no search, no sources and no steps.

Each step is reported as it happens (`BotStep`: action, result, kind, subject): the steps card
("Searching notes → “Recto plan”") and the status text beside the face, in the header and in the
sidebar ("Reading Tutta…", `shared/bot-status.ts`) are both drawn from them, in the question's
language. The steps are saved with the answer. Model tool calls (`model-tools.ts`) exist behind a
setting, off; the harness's own calls are always on.

**Evals** (`npm run bots:eval`, `scripts/evals/`, `src/main/bots/eval-mode.ts`) run the same
`prepare` headless against the fixture vault (`tests/bots/eval/fixture-vault`) or, with `--private`,
a frozen snapshot of the real vault (`~/Recto-eval-vaults/<snapshot>`, named by the private cases):
recall@4, items, router accuracy, named notes, language, and grounding - a note, a number or a
description of a note that the answer's context never had is an ungrounded claim. Each run is one
note `Eval <time> — <label>`: fixture runs in the repo (`docs/evals/<model>/`, data in
`docs/evals/data/<run id>/`), private runs only in the vault's evals folder (data in the hidden
`.recto/evals/<run id>/`). Results keep the prompt, so `npm run bots:eval:rescore` can score a
fixture run again after a fix to the checks.

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
   backlinks, graph, boards, the vault overview - ask the index again through `index:*`.
5. **Editor.** A note opens with `fs:read` into CodeMirror (`features/editor/codemirror.ts`). Typing
   is saved with `fs:write` after 500 ms of quiet, and on close. A save that fails leaves the text in
   the editor, unsaved, and is tried again. A change on disk from elsewhere is reloaded into the
   editor. CodeMirror keeps `\n` inside; a CRLF note is handed back CRLF (`shared/line-endings.ts`,
   which the frontmatter edits and the link rewrite use too).
6. **Topics.** On a timer and when the window regains focus, the topics service in main reads the
   index's graph (`topics-graph`), has the embedder turn changed notes into vectors, clusters them,
   and writes `topics: [[topics/…]]` into the notes' frontmatter - through the same `vault-fs` path,
   as one undoable run. A run and the commands from Settings (rename, delete, rebuild, undo) take
   turns through one lock (`exclusive` in `topics/service.ts`), since each reads the topics state,
   works, and saves it whole.

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
                 colour editor, sliders, toggle, setting row and group, settings search
                 matching, chip styles, tints, the fuzzy matcher and picker keys
  styles/        tokens, element rules, layout, motion
test/            the same folders as src/
```

**Tabs and their history.** Each section (Data, Canvas, Tasks) is a `Workspace` (`app/workspace.ts`):
splits of tab groups of leaves, each leaf `{type, state}`, saved to `.recto/workspace.json`. A leaf
also keeps its own `history` - steps back and forward, each `{type, state, at}` where `at` is where
in a note you were (top line and caret) - up to 100, saved with it. Opening a note, board or card goes
through `use-shell-navigation.ts`: it `navigate`s the tab you are in (the old view becomes a step back)
unless ⌘ is held, the tab is pinned, or it shows a chat or the graph, which get a new tab instead.
`app/tab-history.ts` is what views use: the ← → buttons (`components/NavArrows.tsx`) read a tab's
history, a note reports its place (`setPlaceSource`) and lands back on it (`takeRestore`), and a
board records an opened card as a step (`step`); the shell does the travelling
(`hooks/use-tab-history.ts`, also ⌘[ ⌘] and mouse buttons 4/5). Renames move every step
(`renamePath`); steps to deleted notes are dropped (`pruneMissing`).

| feature | what | CSS block(s) |
|---|---|---|
| `editor` | CodeMirror, live preview, properties, backlinks, outline, history, writing tools, the autocomplete list (`link-complete.ts`; glass, `styles/complete.css`) | `md`, `prop(s)`, `backlinks`, `outline`, `history`, `formatbar`, `focusbar`, `wmenu`, `note-title`, `link-suggest` |
| `file-tree` | the Data tree, drag and drop, context menu, the note preview card (`NotePreviewCard`; a board's shows its columns and progress). The card's lifecycle is the app's one controller, `app/link-peek.ts`, for tree rows and editor links alike: tied to its anchor element, put away by any press, key, scroll, blur or navigation, or when the anchor goes or moves | `tree`, `note-peek` |
| `search` | full-text search, quick switcher | `search-result` (inside the shared `palette`) |
| `graph` | the link graph and its settings panel | `graph`, `gset`, `gwheel`, `glegend` |
| `boards` | kanban boards as notes in the Obsidian Kanban format (`shared/kanban.ts`: parse, and line-level edits that never touch a line they do not mean to): full-height glass columns, a card panel that edits a card note's frontmatter one key at a time (`shared/card-fields.ts`), and a widget strip (`widgets/registry.ts`). `hooks/use-board-cards.ts` reads the board note and the cards' notes; every change is shown first and written second, every board write re-reads the file and makes the same change to what is there now (found by the card's own lines), edits to one card's note go one at a time, and a failed write is undone with a notice. A board note opens as a board in a note tab too (`BoardNote`, through the editor's `NoteHosts`), with its Markdown a click away; a link to a board or a card opens it in the tab you are in, or in Tasks when that tab is not one to move on from (`use-shell-navigation.ts`); a card opened on a board is a step in the tab's history. The card panel edits the note's body with the editor's `NoteBodyEditor` (frontmatter stays the panel's fields', `withBody`). `boards-store.ts` lists boards and where each card stands (from the index), publishes the link icons (`app/link-kinds.ts`) and holds `isTaskPath`, the one rule that keeps Recto/ (boards, cards, chats) out of the Data tree unless Settings → Vault → "Show the Recto folder" is on (`recto-folder-setting.ts`, kept per vault in `.recto/recto-folder.json`). Where the files live is `shared/recto-paths.ts` and nothing else; rename, delete and filing of cards are `main/boards.ts` (see Recto's folder, below). The one-time move from `boards.json` is `shared/board-migration.ts` (plan) and `main/board-migration.ts` (backup, write) | `board`, `board-col`, `board-card`, `board-pri`, `board-cal`, `board-seg`, `board-done`, `board-due`, `board-pris`, `board-widget`, `card-panel`, `new-card`, `boards` |
| `topics` | topics settings and the run notice | `topics` |
| `tidy` | filing loose notes | `tidy` |
| `home` | the overlay on ⌃⌘H: one WebGL scene (`scene.ts`) behind two panes that slide - the welcome, whose text the shader draws (`hero-text.ts`, `scene-text.ts`), and the vault overview, a pane that scrolls as a whole: the vault's name drawn by the shader (moved by a scroll uniform), then a solid card (`components/Overview.tsx`). Main gathers the raw material (`main/overview.ts`: one `overview` query on the index, the `.recto/stats/` files, the userData usage file); every figure is a pure sum in `shared/overview.ts` worked out against the renderer's clock. Where it was left (pane, page, scroll) is `overviewPlace` in `app-state.json`. Edits, active time and last opened are reported from `app/usage.ts` | `home`, `overview` |
| `settings` | the Settings panel: floating glass over the app, moved and resized with the note-window geometry (`app/note-windows.ts`), kept in `appearance.json` as `settingsPanel`; a sidebar of sections, search across them (rows hide themselves via `ui/setting-search.ts`) | `settings-panel`, `settings`, `settings-results`, `setting` notes, `osync`, `hotkeys`, `vault-recent`, `daily`, `note-error` |
| `ai` | the chat's parts every conversation is built from: its turns and its composer | `chat` |
| `templates` | template picker, daily notes | (uses `palette`) |
| `archive` | archived notes | `archive` |
| `links` | unresolved links | `unresolved` |
| `bots` | Recto (the main chat) and the specialist bots, a bot's conversation in chat topics with History, Settings → Bots; shown in the Chats panel (`chats`) | `bot-chat`, `chat-topic`, `bot-history`, `bot-undo`, `bot-sources`, `bot-status` |
| `chats` | the Chats panel (the shown bot's chat; any other bots are in its ⋯ menu), the floating bot and the Quick ask bubble; `chats-store.ts` holds which bot the panel shows and opens it from anywhere; the panel's width and the bot's place are saved with the appearance; the Quick ask thread lives in its window only. Settings → AI → Providers is `settings/components/ProvidersSettings.tsx` | `chats`, `quick-ask`, `floating-bot` |
| `recto-bot` | the bot character: presets (look + personality), the shared frame loop; its design page is dev-only (`/dev/recto-bot`) | `recto-bot`, `bot-design` (dev only) |

Features import each other only through `index.ts`. The app shell imports features; features import
`app/` for the api, the note bus and the view registry, and `ui/` for primitives. `ui/` imports
neither `app/` nor any feature, and `shared/` imports nothing outside itself.

## Recto as an MCP server (AI access)

AI clients (Claude Code, Codex, Claude Desktop, Cursor) reach the vault through Recto, so Recto's
rules apply to them. Nothing in the client touches the files.

```
AI client ──stdio──▶ <userData>/bin/recto-mcp         shell script, rewritten on every start
                       │  ELECTRON_RUN_AS_NODE=1 <Recto's Electron> out/mcp/recto-mcp.mjs
                       ▼
                     src/mcp/index.ts  (MCP SDK; tools from the shared catalogue)
                       │  newline-delimited JSON over a Unix socket (src/mcp/bridge.ts)
                       ▼   <userData>/recto.sock + token in <userData>/mcp-token, both 0600
main: vault-tools/socket.ts  (first line must carry the token)
                       ▼
      vault-tools/index.ts  callTool: validate → scope → run → log → answer
         ├─ scope.ts    built fresh for each call: vault, .recto/ai-access.json, exclusions
         ├─ read.ts     search (FTS + meaning), notes, context, folders, recent, tags,
         │              periodic notes, boards, tasks; asks the indexer, never the renderer
         └─ write.ts    propose_* build a Draft (files before/after, formatted by the profile)
              └─ proposals.ts   Read only: refused · Propose: queued · Write directly:
                                backup, then write through vault-fs
```

- **One catalogue.** `shared/vault-tools.ts` holds the 19 tools (zod schemas, titles, descriptions,
  which ones write) and the prompts; the MCP program and main both use it, so the two ends cannot
  disagree. Note text in an answer is always wrapped in `<note path="…">` blocks, so a client can tell
  a note's words from Recto's.
- **Why a socket.** The client starts `recto-mcp` as its own process, but only the running app has
  the index, the vault and the settings. The socket (mode 0600, plus a random per-install token compared in constant time) lets that process ask
  main, and when Recto is closed the connect fails and the client is told to open Recto.
- **The launcher.** `main/vault-tools/launcher.ts` rewrites `<userData>/bin/recto-mcp` on every start
  with this install's paths, so clients keep one stable command while Recto updates or moves. It runs
  on Recto's own Electron as Node, so no Node install is needed.
- **The build.** `recto-mcp.mjs` is one self-contained bundle (SDK and zod inlined) made by the
  `mcpProgram` plugin in `electron.vite.config.ts` into `out/mcp/`. `electron-builder.yml` lists
  `out/mcp/**` in `asarUnpack`, since other Node runtimes cannot read inside an asar. Claude Desktop
  uses the same file in a `.mcpb` that `buildMcpb` makes on demand.
- **Writes.** Every write tool returns a `Draft`; the mode in `ai-access.json` decides what happens.
  `shared/formatting.ts` (8 rules, detected from the vault or the Obsidian Linter's config) is applied
  only to the lines the AI wrote. A proposal keeps the file's text it was made against; Apply on a
  note that has changed since writes nothing (stale). Names, links, periodic-note templates, boards
  (changed only through the board tools) and excluded folders are checked in `write.ts`.
  `shared/line-diff.ts` makes the diff shown in Suggested edits
  (`renderer/features/suggested-edits/`).
- **Indexer.** Reads that need the whole vault's notes, tags and properties (profile, folders) use the
  `vault-meta` request, answered with `VaultMeta` (`shared/indexer-protocol.ts`).
- **Settings.** `renderer/features/settings/components/AiAccessSettings.tsx` edits the write mode,
  AI guide, formatting profile, exclusions and clients over `main/vault-tools/ipc.ts`. `clients.ts`
  adds Recto's entry to a client's config file (shown first, original backed up, other entries left
  alone) and tests the connection.

| where | what |
|---|---|
| `<vault>/.recto/ai-access.json` | write mode, AI guide note, formatting profile, exclusions |
| `<vault>/.recto/ai-proposals.json` | Suggested edits: pending and settled (kept a while) |
| `<vault>/.recto/ai-activity.jsonl` | one line per tool call: tool, paths, outcome; no note text |
| `<vault>/.recto/backup/ai/<time>/` | files as they were before a direct write |
| `<userData>/backup/clients/<time>/` | a client's config file as it was before Recto edited it |
| `<userData>/bin/recto-mcp`, `recto.sock`, `mcp-token` | launcher, socket, token |

## AI providers inside Recto

Recto's chat and Quick ask can be answered by a provider other than the local model. Providers are
one of two kinds, and either way the vault is reached only through Recto's tool layer
(`vault-tools/`, see above), so the same rules, exclusions and Suggested edits apply.

```
renderer chat / Quick ask ──IPC──▶ main/bots/answers.ts  runCloudJob (saves the thread)
                                     ▼
                         main/providers/index.ts  picks the provider, opens a tool session
              ┌──────────────────────┼───────────────────────────┐
   model providers (HTTP)       CLI agents                     local (Ollama)
   openai.ts · anthropic.ts     cli.ts: codex exec / claude -p   panel: the bots pipeline
   chatgpt-auth.ts + Responses  with only `recto-mcp --session`  Quick ask: ollama.ts loop
   Recto runs the tool loop     the CLI runs its own loop
              └────────── tool calls ▶ vault-tools/index.ts (session-scoped) ◀──┘
```

- **Two kinds.** A *model provider* (OpenAI, Anthropic, ChatGPT plan) only returns text and tool
  requests; Recto runs the loop, calls `callTool` itself and sends the full history every turn
  (`store: false` on the Responses API). A *CLI agent* (Codex CLI, Claude Code) runs its own agent
  loop, so Recto locks it down: Codex gets `exec --json`, a read-only sandbox, its shell and other
  built-in tools disabled, `--ignore-user-config`, `--ephemeral` and an empty temp working
  directory; Claude Code gets `-p` with `--tools ""`, `--allowedTools mcp__recto`,
  `--strict-mcp-config`, `--permission-mode dontAsk` and `--no-session-persistence`. Their only tool
  server is `recto-mcp --session <id> --tools …`. CLI runs are stateless: each question carries the
  transcript. Codex answers arrive whole (steps stream live); Claude Code streams.
- **Sessions** (`vault-tools/sessions.ts`). Each provider run opens a session: which tools are
  allowed, which notes are visible and which are writable. `scope.ts` applies it on top of the
  vault scope on every call, and `--session` rides on each socket request from `src/mcp/index.ts`.
  Trust is therefore in Recto, not in each provider's own sandbox. In-app chats always *suggest*
  (Suggested edits), even in Write directly mode. Quick ask's session makes only the open note
  writable. The session's tool calls become the answer's steps card, and the notes they returned its
  sources.
- **Detection** (`providers/detect.ts`). A Mac app does not inherit the shell PATH, so the CLI is
  looked for through the login shell's PATH (asked once), the app PATH, Homebrew, npm, bun, volta,
  pnpm, `~/.local/bin`, `~/.claude/local`, nvm Node bins and inside ChatGPT.app (which ships the
  Codex CLI). Pre-flight is `codex login status` / `claude auth status`; nothing that spends usage.
- **Credentials.** Recto stores none for the CLIs; they keep their own logins. ChatGPT sign-in
  (`chatgpt-auth.ts`) is OAuth with PKCE in the browser, a callback on 127.0.0.1, dynamic client
  registration and an ID token verified against OpenAI's keys; the ChatGPT tokens and the OpenAI key are
  encrypted with Electron `safeStorage` (login keychain) in `providers/store.ts`, the Anthropic key as
  before in `main/secrets.ts`; ChatGPT tokens are refreshed one request at a time and revoked on
  sign-out. None of them reaches the renderer.
- **The cloud gate.** `cloud` in `<vault>/.recto/ai-access.json` is off until turned on in
  Settings → AI → Providers; `providers/index.ts` refuses a non-local provider while it is off. Background jobs
  (note cards, tasks, topic titles) always run on the local model, topic titles even for cloud chats,
  and only Recto's chat and Quick ask can use cloud; the other bots stay local. Each answer stores
  the model string with a provider prefix (`codex`, `chatgpt:<slug>`); a provider switch is a
  "Switched to …" line in the chat.
- **Exclusions.** Excluded folders hold for every provider: the tool layer hides them; when a cloud
  provider is the target, earlier answers whose sources sit in excluded folders are withheld from the
  history it receives; and the local pipeline now merges them into its own bot exclude list
  (`bots/answers.ts`).
- **Limits and usage** (`providers/limits.ts`, kept in `<userData>/provider-usage.json`). Codex's
  plan windows come from its app server's `account/rateLimits/read` - started, asked, stopped, no
  model call; Claude Code's from the `rate_limit_event` in its stream, so they appear after its first
  answer and are kept. ChatGPT plan and API keys report no remaining quota. Every run's token count
  (the providers' usage fields) is added per provider per day; the picker's maker pages and
  Settings show the limits and "Recto used … today · … this week". The picker groups the cloud ways
  in by maker (`Vendor` in `shared/providers.ts`): Anthropic (Claude Code, API key) and OpenAI
  (Codex, ChatGPT plan, API key).
- **Failures** become `ProblemLine` states (`renderer/features/bots/components/ProblemLine.tsx`): CLI
  missing (Install link), not signed in, sign-in expired, plan limit (Manage usage), not eligible,
  provider down, cloud off (Turn on). Cancel aborts HTTP, and sends CLIs SIGINT, then kill.
- **Chats panel, floating bot, Quick ask** (`renderer/features/chats/`). `ChatsPanel` is a right-hand
  panel (⌘⇧C, a toggle in the top-right `TabBar` that hides while the panel is open), with sections AI and People (People disabled for now), the bot
  list and then the picked bot's chat; `VaultShell` makes it and the graph take turns on the right.
  `FloatingBot` (⌘⇧B, or its status-bar button) is the bot itself, with no plate, draggable, and snaps to the nearest edge. `QuickAsk` (⌘J) is a bubble
  anchored to the bot's saved place (`bubbleAt`: above it in the lower half, below in the upper, lined up with its outer side, a tail
  pointing at it), not a `FloatingWindow`. The bot stands only along the note area's left, right and bottom edges, under the tab bar and the arrows' row and above Linked mentions (`botArea`, kept current by a `ResizeObserver` on those bars and a `MutationObserver` on the view, so a bar that comes with another tab is seen in the next frame); on a board it is not shown. While it is dragged, `bot-motion.ts` (a small store) carries its position to the bubble, so a drag redraws only those two. Quick ask is about the open note: each question calls `get_note_context` (budgeted) for the note and its links,
  an "About: <note>" line marks a change of note, and the thread lives in memory only; "Save as chat"
  writes it as a normal chat in `Recto/Chats`. `shared/quick-ask.ts` holds its shared types and
  `providers/quick-ask.ts` its prompt and session. ⌘⇧H hides every floating window and the bot. Chats
  stopped being a workspace section (`app/sections.ts` is now Data, Canvas, Tasks).

| where | what |
|---|---|
| `src/shared/providers.ts`, `quick-ask.ts` | provider ids, status and problem types, Quick ask types |
| `src/main/providers/` | `detect`, `cli`, `chatgpt-auth`, `openai`, `anthropic`, `ollama`, `run`, `prompts`, `quick-ask`, `limits`, `store`, `ipc`, `index` |
| `src/main/vault-tools/sessions.ts` | tool sessions (allowed tools, visible and writable notes) |
| `src/mcp/index.ts` | `--session` and `--tools` for a provider's CLI |
| `src/main/bots/answers.ts` | `runCloudJob`, `saveThread`, excluded folders for the local pipeline |
| `src/renderer/features/chats/` | `ChatsPanel`, `FloatingBot`, `QuickAsk`, `chats-store` |
| `src/renderer/features/settings/components/ProvidersSettings.tsx` | provider setup and the cloud switch |
| `<userData>/provider-chatgpt.bin`, `provider-openai.bin` (safeStorage) | ChatGPT sign-in and the OpenAI key, encrypted; the Anthropic key stays in `secrets.bin` |
| `<vault>/.recto/ai-access.json` | `cloud` flag, with the rest of AI access |

## Recto's folder

Boards, cards and chats live under `Recto/` (`shared/recto-paths.ts` is the one place that knows
the names; it also holds `placeFor` and `cardFolderFor`, pure and tested). They are notes like any
other - indexed, searched, linked by name, synced - so nothing about them is special to the index
except what it leaves out: the overview counts and lists neither chats nor board notes, and the
graph hides chats unless asked. `Recto/README.md` (and `Recto README.md`) is left out of the graph
(`graph/view-model.ts`) and of every overview count and list (`workers/indexer/queries.ts`).

**Placement.** `main/boards.ts` (`createBoardOps`) keeps card files where their boards say. It acts
only after a Recto action (a card taken off a board, a board deleted, an existing note added), and
only on files already in `Recto/Boards/<Board>/` or `Recto/Unsorted/` (`isPlacedCard`). Which boards
list a card is read from the board files on disk, not the index, so a board written a moment ago
counts. `placeFor`: on no board, Unsorted; on exactly one, that board's folder; on several, it
stays. Every move goes through the same `relocate` as a rename in the tree, one file at a time, so
links follow and version history moves with the note. A note outside `Recto/` that sits on a board
is never moved or trashed. Renaming a board renames its folder and file, moves the cards one by one
and updates `new-note-folder`. Deleting a board takes a choice (Unsorted, another board, or the
macOS Trash through `shell.trashItem`); the board note goes to the Trash too, not the archive, and a
card another board lists is never trashed. Every delete returns an undo id: `undoDelete` puts back
the board, the trashed cards, the moved cards and the lines added to the other board, each only if
the file is unchanged since.

**Names.** Notes are found by name, so a new note's name is checked once, against the files on disk
(`fs:name-taken`, `vault-fs.nameTakenBy`), never the index, which can lag. Names are refused, never changed: `nameProblem` in `shared/vault.ts`
rejects `/ \ : * ? " < > |` and a leading `.` (and, for cards and boards, `# ^ [ ] |`, which break
links), and `vault-fs` create and rename enforce it. The `[[` "Create" row is not offered for such a name.

**Link targets.** `shortestLink` in `shared/parse.ts` gives the shortest path that names a note alone. The
layout migration uses it for rewritten wikilinks (Markdown-style links get the full vault path), and
so does "Add it to this board" (`fs:link-target`).

**Tabs and new files.** `VaultShell`'s prune effect closes a tab only after `fs:existing` confirms on
disk that the file is gone (`Workspace.paths()` lists the candidates), since the tree can lag behind
a note made a moment ago.

**Layout migration.** On the first open of a vault, `main/layout-migration.ts` moves `tasks/` and
`chats/` into `Recto/`. `planLayout` is pure (files in, moves, edits, creates and conflicts out);
`migrateLayout` backs up what it touches, applies the plan and writes `.recto/layout-migration.json`.
If any target is taken it stops and writes nothing. Each move is announced to the indexer as
`note-renamed` before the reindex, so history carries over. Links resolve by name and mostly need no
change; only a link whose target would otherwise change, or that spells a path that no longer
exists, is rewritten (`mapLinkTargets` in `link-rewrite.ts`). Boards it moves get `new-note-folder`.

## On disk

In the vault:

| path | format | owner |
|---|---|---|
| `**/*.md` | markdown with optional YAML-ish frontmatter; unrecognised frontmatter is kept byte for byte | the user |
| `attachments/` | images pasted or dropped into notes | editor |
| `templates/`, `Daily/` (configurable) | ordinary notes | templates |
| `Recto/` | what Recto's features make, as ordinary notes (layout in `shared/recto-paths.ts`): `README.md`; `Boards/<Board>/<Board>.md`, a board in the Obsidian Kanban format (`kanban-plugin: board`, a `## heading` per lane - `Doing (3)` for a WIP limit, `**Complete**` under the done lane - a `- [ ]` item per card, `[[Card]]` for a card that is a note, plain text otherwise, and a `%% kanban:settings` JSON block at the end whose `recto` key holds lane colours and dates, widgets and sort; `new-note-folder` there is where its new cards go) with its cards beside it; `Unsorted/`, cards on no board; `Chats/` (below). A card note has only its own fields - `priority`, `start`, `due`, `tags`, `completed` (set on entering the done lane, removed on leaving it) - and its text; where it sits is the board's | boards |
| `.recto/boards-migration.json`, `.recto/backup/<date>/` | the one-time move from `boards.json` to board notes: what it made and changed (or `none` when there was nothing to move; once it exists, only a `boards.json` coming back runs it again), and a copy of every file it changed (boards.json included) from before (`main/board-migration.ts`) | `main/board-migration.ts` |
| `Recto/Chats/<bot>/` | a bot's chat topics, one note each: `YYYY-MM-DD HH-mm — <title>.md`, frontmatter `bot`, `created`, `title`; `## You` / `## <Bot>` turns (an old main-chat answer keeps `## Claude`), each answer's sources in a `<!-- recto:sources … -->` comment; turns are appended, never rewritten (`shared/chat-topics.ts`) | bots |
| `.recto/layout-migration.json`, `.recto/backup/layout-<date>/` | the one-time move of `tasks/` and `chats/` into `Recto/`: what moved and which links were rewritten (or `none`, `conflicts` with nothing written, `failed`), and a copy of every file it moved or changed from before; read by the notice (`main/layout-migration.ts`) | `main/layout-migration.ts` |
| `.recto/chats-migration.json`, `.recto/backups/chats-<date>/` | the one-time move of the old main chats and first bot threads into Recto's topics: what moved, and a copy of `chats/` from before (`main/bots/migration.ts`; that folder is then moved into `Recto/Chats/` by the layout migration) | `main/bots` |
| `.recto/bots/<id>/` | a bot: `bot.json` (name, specialty, look, personality, model, excluded folders), `SYSTEM.md` and `EXAMPLES.md` (one example answer per kind); Recto is written once into a vault with no `bots` folder, and an unedited SYSTEM.md or EXAMPLES.md is brought up to date | `main/bots` |
| `.recto/evals/<run id>/` | an eval run's `config.json` and `results.jsonl`, and `graded.jsonl` beside them; the run's report is a note in the evals folder | `scripts/evals` |
| `.recto/<feature>.json` | one JSON file per feature: `appearance`, `workspace`, `graph`, `writing`, `templates`, `hotkeys`, `tree-order`, `authors`, `topics`, `topics-settings`, `archive` | `main/state.ts` |
| `.recto/stats/edits.json`, `.recto/stats/words.json` | the vault overview's history: per day, the notes you edited (editor saves, card edits and moves you made; backfilled once from version history) and the words you wrote (`written`: per day and note, the words your saves brought in and kept, as `{ word: count }` - a save's deletions take back that day's words first, `shared/overview.ts applyWords`; read in once from version history); and the vault's total words, first and last count, with the counting rule (`rule`; a day counted under an older rule starts again). Every write reads, merges and replaces the file whole; an iCloud conflict copy (`edits 2.json`) is merged in and removed on the next read | `main/overview.ts` |
| `.recto/index.db` | SQLite (WAL): the index, tasks, version snapshots, usage events, topic vectors, the bots' piece vectors, note cards and tasks read from plain text | indexer, embedder |
| `.recto/archive/` | archived files until retention runs out | `main/archive.ts` |
| `.recto/.gitignore` | keeps `index.db`, `.trash/` and `archive/` out of git | written once |

Topics are written into notes as `topics: ["[[topics/Name]]"]`; a topic has no file of its own.

Outside the vault, in the app-data folder (`~/Library/Application Support/Recto/`):
`app-state.json` (last and recent vaults, where the vault overview was left), `overview-usage.json`
(seconds active in Recto per day; per vault, when each note was last opened), `secrets.bin` (the API key, encrypted with Electron
`safeStorage`), `obsidian-sync.json` and `obsidian-sync/` (pairings and sync manifests), `models/`
(the embedding model).

## Why the index is a cache

The files are what the user owns: they sync, go into git, open in other editors, and outlive this
app. If the index were the truth, every one of those would be a way to lose data. So every fact in
`index.db` is recomputed from the files - delete it and the next launch rebuilds it - and nothing a
user cares about may live only in SQLite. The two exceptions are recorded, not derived: version
snapshots and usage events. Losing them loses history, never notes, and the migrations, the parser
and the link resolver can all change freely because a rebuild is always safe.
