# Refactor phase 1 — formatting and lint

Only formatting and lint. No behaviour change: the checks below show the built
app is the same program.

## Added

- **Prettier 3.9** (`.prettierrc.json`, `.prettierignore`): no semicolons,
  single quotes, trailing commas, `printWidth` 140. 140 because it matches the
  code as written: it changed 3,211 lines against 3,735 at 120. Ignored: build
  output, `test/fixtures/` and `resources/` (data), and `*.md` (prose).
- **ESLint 10** (`eslint.config.js`, flat config): `@eslint/js` recommended,
  typescript-eslint recommended, react-hooks for `src/renderer/`, Node or
  browser globals per folder.
- Scripts: `npm run lint`, `npm run format`, `npm run format:check`.

## The reformat

`prettier --write .` touched 129 files (+3,057 −1,348 lines). It changes no
logic. Checked on the build: `out/` before and after, compared file by file
with all whitespace removed.

- Main process, indexer, embedder, preload: identical.
- Renderer JS: 111 of 112 chunks identical. The main chunk differs in 8
  places, all JSX text where one text piece became two adjacent ones or the
  other way round (`", "` versus `","` + `" "`, `"retried: "` versus
  `"retried:"` + `" "`). They render the same characters.
- CSS: 6 colour values written `0.10` became `0.1`. Same value.

One of those JSX splits is visible to a pixel comparison and nothing else:
Settings → Templates, the line with `{{title}}, {{date:+7}}`. Two text runs
instead of one shift the glyphs' sub-pixel position, and the anti-aliasing
inside a "t" and a "+" changes: 97 pixels, the same in both themes, under the
100-pixel tolerance. No character moved.

## Lint

The first run: 97 findings in 37 files. What happened to them:

| | findings | |
|---|---|---|
| `no-undef` in TypeScript | 13 | config: TypeScript checks names itself; typescript-eslint recommends it off. The findings were in `scripts/snapshots.mjs`, whose `page.evaluate` callbacks run in the browser - that file now gets browser globals |
| `no-require-imports` in `build/*.cjs` | 5 | config: CommonJS build hooks may `require` |
| unused imports | 4 | fixed: `Snapshot` (indexer), `cosine` (topics service), `Extension` (codemirror), `Icon` (VaultShell) |
| unused variables | 4 | fixed: `revision` and `layout`, destructured and never read; `hex` in graph/look.ts, never called. `_next` (a deliberately unused parameter): config, `^_` is the ignore pattern |
| `no-useless-escape` | 2 | fixed: `\\[` inside a character class in `ONLY_LINKS` (core/frontmatter.ts) - same regex |
| unused `eslint-disable` comments | 1 (then 7) | kept: they mark deliberate exceptions to `exhaustive-deps`, which is off for now; reporting unused directives is off so they survive until it is back on |
| the rest | 68 | rules switched off, below |

Now: `npm run lint` - 0 problems. `npm run format:check` - all files formatted.

## Rules switched off (not mechanical)

| rule | findings | why it is not a mechanical fix |
|---|---|---|
| `react-hooks/refs` | 25 | reads or writes `ref.current` during render. Fixing means changing when the value is read - a behaviour question, not a mechanical edit. |
| `react-hooks/set-state-in-effect` | 21 | calls setState synchronously inside an effect. Each needs deciding: derive the state, move it to an event handler, or keep it. |
| `react-hooks/exhaustive-deps` | 12 | effect and callback dependency lists. Adding a dependency changes when the effect runs; several are deliberate, and say so in a comment. |
| `react-hooks/use-memo` | 2 | useMemo used in a way the React Compiler rules reject. |
| `react-hooks/immutability` | 2 | mutates a value React treats as immutable. |
| `react-hooks/preserve-manual-memoization` | 1 | a manual memo the compiler cannot preserve. |
| `no-useless-assignment` | 4 | an initial value that is always overwritten. Removing it means rewriting the declaration for the type checker. |
| `no-control-regex` | 1 | a regex that matches control characters on purpose (rejecting them in file names). |

Where each finding is (after formatting):

- `react-hooks/refs`: `src/renderer/components/ColorEditor.tsx:150`, `src/renderer/components/FileTree.tsx:152`, `src/renderer/components/FileTree.tsx:160`, `src/renderer/components/FocusBar.tsx:53`, `src/renderer/components/SidebarThemePicker.tsx:35`, `src/renderer/components/StrengthSlider.tsx:92`, `src/renderer/components/WritingButtons.tsx:68`, `src/renderer/core/use-workspace.ts:149`, `src/renderer/core/use-workspace.ts:202`, `src/renderer/core/use-workspace.ts:207`, `src/renderer/editor/Editor.tsx:45`, `src/renderer/graph/GraphPanel.tsx:92`, `src/renderer/graph/GraphPanel.tsx:479`, `src/renderer/views/VaultShell.tsx:404`, `src/renderer/views/VaultShell.tsx:458`, `src/renderer/views/VaultShell.tsx:460`, `src/renderer/views/VaultShell.tsx:475`, `src/renderer/views/VaultShell.tsx:477`, `src/renderer/views/VaultShell.tsx:480`, `src/renderer/views/VaultShell.tsx:482`, `src/renderer/views/VaultShell.tsx:484`, `src/renderer/views/VaultShell.tsx:545`, `src/renderer/views/VaultShell.tsx:559`, `src/renderer/views/VaultShell.tsx:710`, `src/renderer/views/VaultShell.tsx:932`
- `react-hooks/set-state-in-effect`: `src/renderer/ai/ChatView.tsx:66`, `src/renderer/components/CommandPalette.tsx:30`, `src/renderer/components/CommandPalette.tsx:35`, `src/renderer/components/History.tsx:48`, `src/renderer/components/NotePreviewCard.tsx:49`, `src/renderer/components/ObsidianSync.tsx:76`, `src/renderer/components/QuickSwitcher.tsx:58`, `src/renderer/components/QuickSwitcher.tsx:63`, `src/renderer/components/SearchPanel.tsx:36`, `src/renderer/components/TemplatePicker.tsx:44`, `src/renderer/core/daily-note.ts:30`, `src/renderer/graph/GraphView.tsx:80`, `src/renderer/graph/GraphView.tsx:343`, `src/renderer/home/HomeOverlay.tsx:199`, `src/renderer/home/HomeOverlay.tsx:235`, `src/renderer/views/MarkdownView.tsx:94`, `src/renderer/views/MarkdownView.tsx:193`, `src/renderer/views/SettingsView.tsx:284`, `src/renderer/views/SettingsView.tsx:336`, `src/renderer/views/TopicsSettings.tsx:60`, `src/renderer/views/WritingSettings.tsx:71`
- `react-hooks/exhaustive-deps`: `src/renderer/components/FileTree.tsx:442`, `src/renderer/core/use-workspace.ts:201`, `src/renderer/core/use-workspace.ts:206`, `src/renderer/graph/GraphView.tsx:499`, `src/renderer/graph/GraphView.tsx:617`, `src/renderer/graph/GraphView.tsx:752`, `src/renderer/home/HomeOverlay.tsx:440`, `src/renderer/views/VaultShell.tsx:87`, `src/renderer/views/VaultShell.tsx:146`, `src/renderer/views/VaultShell.tsx:153`, `src/renderer/views/VaultShell.tsx:261`, `src/renderer/views/VaultShell.tsx:576`
- `react-hooks/use-memo`: `src/renderer/core/use-workspace.ts:202`, `src/renderer/core/use-workspace.ts:207`
- `react-hooks/immutability`: `src/renderer/home/HomeOverlay.tsx:311`, `src/renderer/views/VaultShell.tsx:475`
- `react-hooks/preserve-manual-memoization`: `src/renderer/home/HomeOverlay.tsx:450`
- `no-useless-assignment`: `src/main/vault-fs.ts:53`, `src/main/vault-fs.ts:54`, `src/renderer/editor/obsidian-syntax.ts:61`, `src/renderer/editor/obsidian-syntax.ts:78`
- `no-control-regex`: `src/main/vault-fs.ts:329`

## Checks

| check | baseline | phase 1 |
|---|---|---|
| typecheck | clean | clean |
| lint | - | 0 problems |
| `npm test` | 694 passed, 2 skipped | 694 passed, 2 skipped |
| e2e | 1 passed | 1 passed |
| live-model topics check | passed | passed |
| screenshots (36) | - | same as the baseline; noise: board 55 px, Templates 97 px (both themes, explained above), start and tree 1 px (dark) |
| smoke: edit saved, search | passed | passed (both themes) |
| topics run manifest | 3 topics, 14 files | byte-identical |

Bugs logged: none.
