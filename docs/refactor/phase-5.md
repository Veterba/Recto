# Refactor phase 5 — naming and docs

Behaviour-preserving, apart from two phase 3 regressions put back (below).

## Naming

Audited: file names (components PascalCase, modules kebab-case), hooks (`useX`, in `hooks/` unless
they belong to a store), IPC channels (`group:verb-noun`), CSS blocks per feature.

- `app/components/stubs.tsx` → `stub-views.tsx`: it registers views, it is not a component.
- `boards/hooks/use-boards.ts` → `boards/boards-store.ts`: a store with a hook on it, the same
  shape as `app/vault-store.ts`; `hooks/` holds hooks only.
- IPC `index:home-stats` → `index:vault-usage` (`IPC.indexVaultUsage`), and the indexer message
  `home-stats` → `vault-usage`: it returns `VaultUsage`; "home stats" is what the home screen makes
  of it.
- CSS, "fix misleading only" (decided with the user; a strict one-prefix rename was not done):
  - `autolinks__*` → `topics__*` - the feature was renamed to topics long ago.
  - search's bare `result` → `search-result`; the preview card's `peek` → `note-peek` (and its
    keyframes).
  - `.chip` moved from `archive.css` to `ui/styles/chip.css` and the setting row's base rules from
    `settings.css` to `ui/styles/setting-row.css`: both are shared primitives (`ui/SettingRow`),
    styled from inside one feature.
  - `.suggested` removed: the retired suggested-links row; nothing renders it.
  - The feature → CSS block table is in `docs/ARCHITECTURE.md`.
- `app/sidebar-theme.ts` split: the tint and colour-pad maths moved to `ui/tint.ts`. The colour
  editor (`ui/`) had been importing it from `app/`, the one place `ui/` reached up; the sidebar
  theme's own shape, presets and coercion stay in `app/`.

## Comments

- Stale paths: `core/note-bus`, `core/note-preview`, `core/frontmatter` (folders gone since phase 2),
  "the single app.css", "the wrapper in `editor.ts`" (it is `codemirror.ts`, and CodeMirror types do
  cross it).
- "auto-links" where it meant the current feature → "topics" / "topic links" (graph, renderer,
  worker, protocol, parser, indexer, main). Kept where it means the old pairwise links that the
  topics service removes once, and in the migrations.
- Wrong: the indexer said deleting `index.db` loses "usage history and nothing else"; it also loses
  version history (`snapshots`). `eligible.ts` spoke of notes "as source or as target" - pairwise
  wording.
- Misplaced: an orphaned "Where images land" doc in `main/ipc.ts`; a run's doc sitting on `reject`
  instead of `addRun`; stacked doc pairs in `sections.ts`, `index-results.ts`,
  `indexer-protocol.ts`, `queries.ts`, merged.
- Kept: every comment that says why; the three `TODO`s in `home-stats.ts` are true (those figures
  need the `events` table).

## Docs

- `docs/ARCHITECTURE.md`: processes, what crosses IPC, a note from disk to index to screen, where
  each feature lives (with its CSS blocks), the on-disk formats, why the index is a cache.
- A README in `src/main`, `src/preload`, `src/renderer`, `src/shared`, `src/workers`: what is there
  and what may import it. The rules were checked against the code: no feature reaches into another's
  internals, `ui/` imports neither `app/` nor features, `shared/` imports nothing outside itself and
  no `electron`/`node:`, nothing imports `main/`, `preload/` or the workers.
- `README.md`: the `.recto/` file list (`tree-order`, `topics`, `topics-settings` were missing), the
  API key (an encrypted file in the app-data folder, not "the keychain"), the preload (`invoke` and
  `on`), `styles/`, and a pointer to ARCHITECTURE.

## Phase 3 regressions found and fixed

A rule-order check of the old `app.css` against the built CSS - every pair of equal-specificity rules
that set one property, can meet on one element, and changed order - found two, both from splitting
`app.css` in phase 3 (details in `bugs.md`): the failed API-key test lost its red, and a tree row's
drop highlight could lose to hover. Both put back. After the fix no such pair is left.

## Manual checklist, on a vault copy (`snapshots/checklist.mjs`, local, gitignored)

The built app on a fresh copy of the fixture vault, every step checked on disk or in the DOM:

| # | check | result |
|---|---|---|
| 1 | vault opens, tree loads; a note opens in live preview | pass |
| 2 | typing saves to disk; closing an untouched note leaves bytes and mtime alone | pass |
| 3 | rename: links in 3 notes rewritten; undo restores name and links | pass |
| 4 | drag a note onto a folder: moved, a path link to it followed, drop target drawn in the accent tint; reorder a folder, survives a reload | pass |
| 5 | graph: hover names a dot, click opens its note, drag moves it and opens nothing, zoom; full size: settings panel, a setting saved to `graph.json` | pass |
| 6 | full-text search and the quick switcher open their result | pass |
| 7 | context menu: new note, new folder; move to archive, restore from the archive view | pass |
| 8 | insert a template; open today's daily note | pass |
| 9 | tidy: plan and confirm (3 loose notes → 1) | pass |
| 10 | Tasks: New task makes a card and opens it | **fail - card made, not opened; same on v0.34.11 (bugs.md #3)** |
| 11 | settings: 9 tabs, a toggle saved to `appearance.json`; failed-test note is red | pass |
| 12 | home: opens, slides to statistics, closes | pass |

22 of 23. The driver clears the pickers before typing, because of bugs.md #2.

## Checks

| | baseline | phase 5 |
|---|---|---|
| typecheck / lint / Prettier / knip | clean | clean |
| `npm test` | 694 passed, 2 skipped | 710 passed, 2 skipped |
| e2e | 1 | 1 passed |
| live-model topics check | passed | 5 passed |
| topics run | - | manifest byte-identical; second run changes nothing |
| screenshots vs phase 0 | - | same, apart from the machine's Obsidian vault list (as in phase 4) |
| computed styles + pixels vs phase 4 | - | identical on all 36 screens, class renames mapped |
| manual checklist | - | 22/23; the one failure predates the refactor |

Bugs logged: 3 (all pre-existing). Regressions fixed: 2 (phase 3).
