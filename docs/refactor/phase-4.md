# Refactor phase 4 — code

Behaviour-preserving. No file format, UI or dependency changed. knip, jscpd and madge were run
through `npx`; none was added to `package.json`.

## The IPC contract

`src/shared/ipc-contract.ts` is gone. `src/shared/ipc.ts` holds the contract and nothing else:

- `IPC` (71 invoke channels) and `IPC_EVENT` (8 push channels): the only place a channel name is
  written. Code says `api.invoke(IPC.fsRead, path)`, never `'fs:read'`.
- `IpcApi` and `IpcEvents`, keyed by those constants. An `Exhaustive<>` check fails the build if a
  channel has no signature or a signature has no channel (both directions tested by breaking it).
- The preload's allow-lists are `Object.values(IPC)` and `Object.values(IPC_EVENT)`, not a second
  hand-kept list.
- Main pushes through `sendEvent(win, channel, ...args)` (`src/main/events.ts`), typed against
  `IpcEvents`; the payloads were `unknown` before.

The domain types the contract carries moved beside it, as `shared/topics.ts` already did:
`shared/vault.ts`, `shared/ai.ts`, `shared/obsidian-sync.ts`, `shared/archive.ts`,
`shared/index-results.ts`.

One string channel is left outside `src`: `scripts/snapshots.mjs` calls `'index:search'` from inside
the page, where it cannot import TypeScript.

## Environment variables

Every `RECTO_*` variable the app reads is read in `src/main/config.ts`, whose header documents all
of them (`RECTO_ALLOW_REAL_VAULT`, `RECTO_MODEL_DIR`, `RECTO_AUTOLINKS_ANY_POWER`,
`RECTO_WRITE_LOG`) and the test-only ones (`RECTO_E2E`, `RECTO_RECORD_FIXTURE`). `RECTO_MODEL_DIR`
stays in the environment, as before, so the worker processes still inherit it.

## Dead code (knip)

Removed, used nowhere: `sameName` (topics/eligible), `embedderRunning`, `vaultStillExists`,
`resetNoteBus` and `resetBoards` (test seams no test used), `seedTemplate`, and `plainText` and
`mentions` in `topics/text.ts` (same-named functions elsewhere hid them) with the `OwnLine.plain`
field only they read. `export` dropped from 110 names used only in their own file. knip is clean.

## Duplicated helpers, merged

| helper | was | now |
|---|---|---|
| `extractTargets` | main `link-rewrite.ts` + renderer `link-targets.ts` (a comment said they could not share a module; `src/shared` exists now) | `shared/parse.ts` |
| code-fence regex | 4 copies | `CODE_FENCE`, `shared/parse.ts` |
| frontmatter fence scan | `frontmatter.ts`, `parse.ts`, `ai/conversation.ts` | `frontmatterClose()`, `shared/frontmatter.ts` |
| name → paths lookup for link resolution | indexer ×3, topics service | `pathsByName()`, `shared/parse.ts` |
| `isHidden` + the hidden-name set | `vault-fs.ts`, indexer | `shared/vault.ts` |
| `sortNodes` + collator | `vault-fs.ts`, `file-tree-ops.ts` | `shared/vault.ts` (returns a new array; main's in-place caller used the return value) |
| `parentOf` / `nameOf` | `FileTree.tsx`, `file-tree-ops.ts`, tidy's `folderOf` | `shared/vault.ts` |
| id-stripping `strip` | `topics/runs.ts`, `topics/state.ts` | `withoutId()`, `topics/state.ts` |
| tree walks (all files / notes / note entries) | 6 inline walks in `VaultShell`, `QuickSwitcher.flattenFiles` | `features/file-tree/tree-lists.ts` |
| picker query/cursor/keys | `CommandPalette`, `QuickSwitcher`, `SearchPanel` | `ui/picker.ts` |
| on/off switch | 9 inline copies of the toggle markup | `ui/Toggle.tsx` |
| setting row | 3 identical `Row` components | `ui/SettingRow.tsx` |

Tests added for every shared function that had none: 16 (694 → 710).

Left as they are, because they are not the same function: `countWords` (topics vs focus bar count
different things), `newId` (different id formats on disk), `toHex` (two different conversions),
`index-client` / `embedder-client` (same message routing, different pending-request shapes; merging
them is a design change).

## `any`

None in `src`, before or after.

## Files over ~400 lines

| file | before | after | split into |
|---|---|---|---|
| `features/home/scene.ts` | 1669 | 627 | `scene-tuning`, `scene-gl`, `scene-shaders-depth`, `scene-shaders-compose`, `scene-flags`, `scene-shapes` (+ `coverageOf`), `scene-text` |
| `main/topics/service.ts` | 1150 | 599 | `storage`, `note-cache`, `grouping`, `writes`, `commands` |
| `graph/components/GraphView.tsx` | 950 | 251 | `view-model`, hooks `use-graph-refs`, `-settings`, `-data`, `use-simulation`, `use-draw-loop`, `use-graph-pointer`; `GraphBar` |
| `app/components/VaultShell.tsx` | 946 | 430 | hooks `use-writing-state`, `use-section-defaults`, `use-shell-navigation`, `use-shell-create`, `use-register-views`, `use-app-commands`, `use-shell-keys`; `use-tidy`, `use-template-actions`; `ShellWindows` |
| `graph/components/GraphPanel.tsx` | 942 | 109 | `graph-panel-sections`, `use-wheel-position`, `SectionWheel`, `LayoutGlyph`, `GraphSwitch`, `ColourSection`, `SectionBody` |
| `graph/renderer.ts` | 831 | 367 | `render-state`, `palette`, `geometry`, `sprites`, `draw-layers`, `draw-labels` |
| `home/components/HomeOverlay.tsx` | 776 | 412 | `use-home-scene`, `HomeStatistics`, `home-hotkey`, `hero-text`, `slide` |
| `settings/components/SettingsView.tsx` | 802 | 124 | one file per tab, `SettingGroup`, `settings-deps` |
| `file-tree/components/FileTree.tsx` | 755 | 466 | `tree-rows`, `TreeRow`, `tree-menu`, `use-tree-order`, `use-note-peek` |
| `workers/indexer/index.ts` | 741 | 332 | `db`, `queries` |
| `editor/live-preview.ts` | 627 | 322 | `live-preview-state`, `live-preview-widgets`, `block-hiding` |
| `editor/components/MarkdownView.tsx` | 597 | 479 | `NoteTitle`, `FileView` |
| `graph/layout.ts` | 567 | 330 | `layout-tree` |
| `editor/markdown-actions.ts` | 564 | 299 | `list-indent`, `active-formats` |
| `editor/blocks.ts` | 559 | 295 | `list-geometry`, `code-widgets` |
| `editor/structure.ts` | 550 | 41 | `folding`, `list-guides` |
| `editor/codemirror.ts` | 455 | 402 | `editor-handle` |
| `editor/rich-widgets.ts` | 441 | 263 | `table-widget`, `callout-widget` |
| `boards/components/BoardView.tsx` | 435 | 397 | `BoardHost` (the view registration) |
| `graph/simulation.worker.ts` | 498 | 498 | - |

How the splits keep behaviour: declarations moved whole with their comments (a TypeScript-API
script resolved every identifier and wrote the imports); components became hooks called at the same
point in the same order, so React runs their effects in the order it did; no import cycle anywhere
(madge, with the path aliases resolved, over all 307 files).

Still over 400, and why:

- `home/scene.ts` (627), `topics/service.ts` (599), `graph/simulation.worker.ts` (498): each is one
  piece of mutable state - a WebGL context and its frame loop, the topics service's timers and
  per-note records, the physics worker's simulation - that the remaining functions all reassign.
  Splitting further means restructuring that state, not moving code.
- `MarkdownView.tsx` (479): the editor's load, save, flush, rename and external-change effects are
  interleaved around one editor handle; pulling some into a hook reorders them, which is exactly the
  save path a behaviour-preserving phase should not touch.
- `FileTree.tsx` (466), `VaultShell.tsx` (430), `HomeOverlay.tsx` (412), `codemirror.ts` (402): at
  the ~400 line; what is left is JSX and one keyboard handler each.

## Checks

| | baseline | phase 4 |
|---|---|---|
| typecheck / lint / Prettier | clean | clean |
| knip | - | clean |
| `npm test` | 694 passed, 2 skipped | 710 passed, 2 skipped (16 new) |
| e2e | 1 | 1 passed |
| live-model topics check | passed | 5 passed |
| topics run | - | manifest byte-identical; second run changes nothing |
| screenshots vs phase 0 | - | same, except the environment differences below |
| computed styles vs pre-phase-4 build | - | same, except the environment differences below |

Differences that are not the code, each checked: `01-start`/`02-tree-expanded` and one
`05-search-open` run show a row in its hover state - the real pointer resting over the window, and
the pre-phase-4 build shot the same way today; `13-settings-obsidian` lists the Obsidian vaults
registered on this machine, and one note count there changed; list hanging indents and the text
column's centring margin were once captured before CodeMirror measured them (the screenshots of the
same screens did not differ, and a rerun matched).

Bugs logged: none.
