# Refactor baseline (phase 0)

Taken on `refactor/codebase` at `d0077c5` (v0.12.5), before any code change.
Every later phase is checked against these numbers and the screenshots in
`snapshots/baseline/` (gitignored - kept on this machine).

## Inventory

| | |
|---|---|
| tracked files in `src/` | 165 (107 `.ts`, 55 `.tsx`, 2 `.css`, 1 `.html`) |
| tracked files in `src/`, `test/`, `scripts/` | 236 |
| lines of code, `src/` (ts, tsx, css, html) | 43,639 |
| lines of code, `test/` | 6,089 |
| source files over 400 lines | 24 |
| `app.css` | 7,621 lines, 176,358 bytes |
| `tokens.css` | 444 lines |
| renderer bundle (`out/renderer`) | 6.9 MB total; JS 5.3 MB in 114 chunks (main chunk 3.86 MB), CSS 244 KB |
| main + workers bundle (`out/main`) | 208 KB (main 153 KB, indexer 30 KB, embedder 9 KB) |
| packaged `.app` (`npm run dist:dir`, arm64) | 506 MB |

### The 30 largest source and test files (lines)

| file | lines |
|---|---|
| src/renderer/styles/app.css | 7621 |
| src/renderer/home/scene.ts | 1667 |
| src/main/topics/service.ts | 1130 |
| src/renderer/views/VaultShell.tsx | 978 |
| src/renderer/graph/GraphView.tsx | 966 |
| src/renderer/graph/GraphPanel.tsx | 855 |
| src/renderer/views/SettingsView.tsx | 842 |
| src/renderer/graph/renderer.ts | 814 |
| src/renderer/home/HomeOverlay.tsx | 769 |
| src/renderer/components/FileTree.tsx | 763 |
| src/indexer/index.ts | 750 |
| src/renderer/editor/live-preview.ts | 646 |
| src/renderer/views/MarkdownView.tsx | 602 |
| src/renderer/graph/layout.ts | 582 |
| src/renderer/editor/markdown-actions.ts | 569 |
| src/renderer/editor/blocks.ts | 563 |
| src/renderer/editor/structure.ts | 556 |
| src/renderer/graph/simulation.worker.ts | 504 |
| src/shared/ipc-contract.ts | 479 |
| src/renderer/editor/codemirror.ts | 467 |
| src/renderer/board/BoardView.tsx | 458 |
| src/renderer/styles/tokens.css | 444 |
| src/renderer/editor/rich-widgets.ts | 441 |
| src/renderer/components/Properties.tsx | 417 |
| test/topics-naming.test.ts | 396 |
| src/main/ipc.ts | 395 |
| test/markdown-actions.test.ts | 379 |
| src/renderer/core/appearance.ts | 369 |
| src/renderer/core/workspace.ts | 365 |
| src/main/vault-fs.ts | 348 |

## Tests

| check | result |
|---|---|
| `npm test` (typecheck + vitest) | 40 files passed, 1 skipped; **694 tests passed, 2 skipped** (the e2e, and the live-model fixture check - both opt-in) |
| `RECTO_E2E=1 npx vitest run test/e2e` | 1 file, 1 test passed |
| live-model topics check (`RECTO_MODEL_DIR=… npx vitest run test/topics-vault.test.ts`) | 5 passed: 6 subjects → 6 pure topics, 5 named, Money unnamed |
| lint | none configured yet (phase 1) |

## Screenshots: `npm run snapshots`

`scripts/snapshots.mjs` builds nothing itself (`npm run snapshots` builds
first), then drives the built app through Playwright's Electron driver on a
fresh copy of `test/fixtures/snapshot-vault` (synthetic notes - the repo is
public). 18 screens, light and dark: start, file tree expanded, a long note
(top and scrolled), search, graph, a board, all nine settings tabs, home,
statistics. Then a smoke check: an edit typed into a note reaches the file on
disk, and a search finds notes.

    npm run snapshots -- --out snapshots/phase-N --compare snapshots/baseline

What is pinned so two runs agree: the vault path, file dates, window size,
the renderer's clock (`Date` only), `Math.random` in the renderer (seeded),
reduced motion, hidden scrollbars, and waits on the things that load late
(search results, CodeMirror line heights, the settings dialog's entrance).
What is not: Chromium's GPU rasteriser anti-aliases a few edge pixels
differently per launch (up to 55 per shot, measured). A shot fails only at
100 differing pixels or more; smaller differences are printed as noise.
Checked: five consecutive runs, the last three all "same as the baseline".

## Topics run

`snapshots/baseline/topics/topics-baseline.sh` makes a fresh copy of the
Recto-vault copy used for the topics work, runs a full topics pass plus two
more in the dev app, and writes a manifest: the hash of every note and the
normalised `topics.json` (timestamps dropped, topic ids replaced by stable
labels). Baseline: `snapshots/baseline/topics/TA.manifest` - 3 topics
(Cabinet · editor 6, Equation · formula 4, Plugin · load 3), 14 files written,
second run changes nothing. A later phase must produce an identical manifest.
