# Changelog

Entries up to v0.47.1 were reconstructed on 2026-10-15 from git commit messages (the original log was
lost). They say only what the commit messages say. Versions with internal changes only (refactors,
merges, tooling, README and CLAUDE.md edits) are left out.

## v0.48.0 — 2026-10-16
### Changed
- Settings is a floating glass panel over the app instead of a modal: no dimmed backdrop, and the app stays usable behind it, so changes show as you make them. It is solid with Translucency off.
- Drag the panel by its title bar, double-click the title bar to centre it, and resize it from the left, right and bottom edges or the corner (460×300 at least). Its place and size are kept between launches, and it stays inside the window when the window shrinks.
- ⌘, while Settings is open brings focus back to it. Esc closes it, except in a field that uses Esc. Focus goes back to where it was when it closes.
- Sections are in a sidebar grouped as App, Vault and Connections, replacing the tab row that ran off the edge. Each section has a title and a one-line description, and its settings sit in labelled cards.
- Long explanations sit behind an ⓘ next to the setting they explain.
- Settings that depend on another one stay visible but dim and disabled while it is off, for example a period's template and folder under Periodic notes.
### Added
- Search in Settings: shows the matching settings from every section with the words marked, and you can change them right there. A section's heading opens that section.

## v0.47.2 — 2026-10-16
### Fixed
- "Today's note" (the command, ⌘⇧D and the status bar button) opens the note of the shortest period that is on: with daily notes off and weekly on, it opens this week's note. It no longer makes a daily note and its folders when daily notes are off.
- With no periodic notes on, "Today's note" makes nothing and says so, with a button to Settings → Periodic notes.

## v0.47.1 — 2026-10-11
### Added
- Memory use shown in Settings.
### Changed
- The model unloads after N minutes without bot use (Settings → Bots, default 5) and loads when a chat opens or you type to a bot.
- Background vectors and note cards run only on the charger and when idle, and typing stops them.

## v0.47.0 — 2026-10-11
### Added
- Hotkeys for every command: grouped, searchable, rebindable with conflict checks.
- ⌘/ cheat sheet of hotkeys.
- Obsidian highlight colours, with a ⌘⌥H picker and a ⌘⇧H toggle.
### Changed
- Editor keys yield to commands.

## v0.46.1 — 2026-10-11
### Added
- New file… command.
### Changed
- Renaming a file can change its type: the full name is editable, and Recto asks when a file stops or starts being a note.
- Tabs follow renames.

## v0.46.0 — 2026-10-11
### Added
- Periodic notes.
- The formatting toolbar can be hidden.

## v0.45.4 — 2026-10-11
### Added
- `link_status` tool for bots.
- Evals for edit requests.
### Fixed
- Bots never claim to change notes.

## v0.45.3 — 2026-10-10
### Added
- '+' add-row bar and add-column strip on the visible table box; row handles in their own gutter, scrollbar aligned.
- Separate row, column and table menus with previews, icons, segmented alignment, ⌥-arrow moves and keyboard navigation.
### Changed
- Tables sit in the text column and scroll as one piece.
- One lit handle while dragging.
- The 'Quiet' table look everywhere.
### Fixed
- Typing next to a table never lands in it (a blank line is added with the first key, one undo step).
- Tables never flip to raw source in Live Preview.

## v0.45.2 — 2026-10-10
### Changed
- Bots are experimental, with a per-vault switch (off in new vaults); nothing bot-related runs when it is off.
- Model warm-up moved to vault open.

## v0.45.1 — 2026-10-10
### Changed
- Tables stay in the text column: they scroll inside their box, the first column is held, columns are content-sized, one-link cells stay on one line.
- A blank line is kept under every table Recto writes; leaving or clicking below a table lands in a paragraph after it.

## v0.45.0 — 2026-10-10
### Added
- Tables edited like a spreadsheet in Live Preview: toolbar size picker and 'Insert table'.
- Cells edited in place (Tab, Enter, arrows, Esc; Shift+Enter for `<br>`).
- Row and column handles with a menu (insert, duplicate, move, align, numeric-aware sort, delete), drag to reorder, '+' to add.
- Rectangle selection with TSV/markdown copy and clear.
- TSV/CSV paste into cells, and 'Paste as table' outside tables.
### Changed
- Tidy GFM written back, one undo step per action.
- PDF previews limited to vault paths.

## v0.44.0 — 2026-10-10
### Added
- Code and data files open in a code editor: syntax by type, line numbers, folding, jsonl records, json Format, ⌘F, saved like notes, read-only over 5 MB, never indexed.
- Image and PDF previews, and a Show in Finder card for other files.
- File-type icons in the tree.
- Sanitised HTML in notes (tables, details, br, sup/sub, kbd) and 'Convert HTML table to Markdown'.
### Fixed
- Editor commands work from the command palette again.

## v0.43.5 — 2026-10-10
### Changed
- Symlinks out of the vault are refused everywhere (open, vault://, write, index, watcher, bots), with a one-line notice listing skipped links.
### Fixed
- Root and target paths are resolved with realpath, handling missing parents and dangling links; `..notes.md` is allowed.

## v0.43.3 — 2026-10-10
### Added
- Part C: project tasks by topics, project, folder and links, with guesses kept apart.
- Grounding check for numbers and note descriptions.
- Status text and steps card built from step events, in the question's language.
- Evals: frozen private eval snapshot, fixture runs in `docs/evals`, rescore command; final evals for qwen3.5:9b and gemma4:e4b.
### Changed
- Runtime facts (date, model, note count, question language) come after the stable prompt.
- SYSTEM.md v3 with bilingual examples.
- Dates are written by the harness.

## v0.43.2 — 2026-10-10
### Added
- Queued · 2nd label with Cancel.
- Notification when an answer finishes out of sight (setting).
- Power-save blocker while answering.
- Steps saved with each answer.
### Changed
- Answers belong to the main process: a job registry and one queue across topics; the chat, History and sidebar only watch.
- Answers are written to the topic as they stream, and saved as interrupted on quit, with Retry.
- Clear all and delete cancel first.
### Fixed
- Leaving the chat, switching topics or reloading never loses an answer.
- The busy flag is freed on every ending (done, error, stop, delete, 60 s stall).

## v0.43.1 — 2026-10-09
### Added
- `npm run vault:tidy` plans and applies a vault cleanup, with before/after link checks.
### Changed
- Tables wider than the column grow to the pane and scroll in their own box; they wrap only at spaces, short values never wrap, numeric columns are right-aligned.
- Each eval run is one uniquely named note (`Eval <time> — <label>`), raw data in `.recto/evals`, a `Recto evals.md` index, links by name.
- Bots skip eval reports.
### Fixed
- `[[path|alias]]` is safe in table cells and clickable.

## v0.43.0 — 2026-10-03
### Added
- Part A: router (rules plus one short model call, periods computed in code).
- Part A: task index with carried-over and loose tasks; tasks and recent-notes questions answered by the harness.
- Part B: hybrid retrieval (chunk vectors + FTS, RRF); named notes and scopes resolved in code.
- Part B: embedding classifier before the model router.
- Part B: review and advice kinds with scope tools (vault map, read scope, note outline, structure patterns) and background note cards.
- Part B: grouped open-task lists and sticky context.
- Part B: model tool calls behind a setting (off by default).
- Evals: items, router accuracy, ungrounded claims; private cases with rubrics; evals folder left out of the vault copy; model reloaded before the speed check.
### Changed
- SYSTEM.md lets Recto give advice, with its suggestions kept apart.

## v0.42.4 — 2026-10-03
### Changed
- One animation brain per bot, so every face moves, blinks and riffles in sync; seamless riffle and reading loops.
### Fixed
- Focus mode from a split pane uses the centred single-pane column and restores each pane's scroll by text position.

## v0.42.3 — 2026-10-03
### Added
- Bot evals: fixture vault, 33 cases, headless runner, Recto Eval Report v1, baseline and qwen3.5:9b vs gemma4:12b vs gemma4:e4b.

## v0.42.2 — 2026-10-03
### Changed
- A new topic is a clean page, like a new chat.
- History closes on a click elsewhere.

## v0.42.1 — 2026-10-03
### Changed
- Recto chat as a messenger: glass composer, model picker with downloads, bubbles and groups, steps card, message meta, riffle/found animation.
### Fixed
- Readable glass in the light theme.

## v0.42.0 — 2026-10-02
### Added
- Recto becomes the main chat: bots as contacts, conversations in chat topics (one file each; the model sees only the current one).
- History with rename, delete and undo.
- Local or API model picker.
### Changed
- Old chats moved once into Recto's topics.

## v0.41.1 — 2026-10-02
### Fixed
- One answer per question.
- No sources on small talk.
- The bot never talks about its context.
- HTML comments are not indexed.
- The indexer waits for a busy database.

## v0.41.0 — 2026-10-02
### Added
- Bots in the AI sidebar on a local model: Recto answers from the vault via Ollama, with sources under answers.
- Bot definitions and Settings → Bots.

## v0.40.0 — 2026-10-01
### Added
- Recto bot: a page character with eyes-only behaviours, presets and a dev design page.

## v0.39.1 — 2026-10-01
### Added
- Double-click a split divider for 50/50; arrow keys move it.
### Fixed
- Split dividers resize properly: absolute pointer position, 280px minimum, pointer capture, no lag.

## v0.39.0 — 2026-09-28
### Added
- Floating read-only note windows: pin from link and tree previews, move, resize, stack, ⌘Esc, ⌥-drag into a pane; saved in workspace.json.

## v0.38.0 — 2026-09-28
### Changed
- The home page follows the theme: dark palette for both pages (violet glow, light ink), colours as theme tokens, 400ms crossfade.

## v0.37.0 — 2026-09-28
### Added
- Splits by dragging tabs, tree notes, links and search results onto pane edges or centre, with a zone preview.

## v0.36.0 — 2026-09-28
### Added
- Find and replace in the note: a glass card on ⌘F / ⌘⌥F.
### Fixed
- Vim panels and split-pane commands.

## v0.35.1 — 2026-09-27
### Fixed
- Renaming a note keeps `.md`.

## v0.34.6 — 2026-09-26
### Fixed
- Double scrollbar when the rename notice is shown.

## v0.34.3 — 2026-09-26
### Changed
- Lines added to the folder tree.

## v0.34.2 — 2026-09-26
### Fixed
- A small bug with old vaults.

## v0.34.1 — 2026-09-25
### Fixed
- A small graph bug.

## v0.34.0 — 2026-09-25
### Fixed
- Last-stage fixes for the topics feature.

## v0.33.2 — 2026-09-25
### Fixed
- Numbers for the embedder.

## v0.33.1 — 2026-09-24
### Added
- Auto-links use the embedder for context notes.

## v0.33.0 — 2026-09-24
### Added
- Auto-links: a local embedding model suggests and adds related links.

## v0.32.1 — 2026-09-24
### Fixed
- Text disappeared from the first home page.

## v0.32.0 — 2026-09-24
### Added
- Home page and a second page for stats.

## v0.31.2 — 2026-09-19
### Changed
- Improved graph behaviour.

## v0.31.1 — 2026-09-19
### Changed
- Graph behaviour improved.
### Fixed
- Many small UX fixes, especially hotkeys.
- Links written as `[]()` didn't open.

## v0.31.0 — 2026-09-19
### Changed
- Graph node size scales with the number of incoming links, as in Obsidian.
- 'Organic' layout: default values added to 'forces'.

## v0.30.5 — 2026-09-19
### Fixed
- Padding for Settings and Archive in the sidebar.

## v0.30.4 — 2026-09-19
### Changed
- Sidebar corners look better when closed; a few other UI changes.

## v0.30.3 — 2026-09-19
### Added
- New app icon.
- Button to open the current daily note.
### Fixed
- Many note-structure bugs; vertical lines from the Tab key.

## v0.30.2 — 2026-09-19
### Fixed
- More cases of vertical lines disappearing in bullet lists.

## v0.30.1 — 2026-09-18
### Fixed
- Vertical lines disappeared in bullet lists.

## v0.30.0 — 2026-09-18
### Changed
- New logic for vertical lines in notes; small UI changes.

## v0.29.0 — 2026-09-17
### Added
- The app can be built as a regular app.
### Fixed
- Structure of sub-lists in notes.

## v0.28.3 — 2026-09-17
### Fixed
- Error saving files with Cyrillic, emoji, etc.

## v0.28.0 — 2026-09-15
### Added
- Focus writing and text styling.

## v0.27.1 — 2026-09-15
### Changed
- Graph layout algorithms changed again; graph settings UI improved.

## v0.27.0 — 2026-09-14
### Changed
- Graph reworked: settings and layout algorithms changed.
### Fixed
- Many graph bugs.

## v0.26.0 — 2026-09-14
### Added
- Obsidian sync; Obsidian vault support and Obsidian-like styling.

## v0.25.0 — 2026-09-14
### Added
- Links in properties.
### Fixed
- A few bugs.

## v0.24.0 — 2026-09-14
### Added
- Templates in Settings and automatic daily-note templates.

## v0.23.0 — 2026-09-14
### Added
- Arc-like sidebar settings.

## v0.22.0 — 2026-09-13
### Added
- Basic AI via API.

## v0.21.0 — 2026-09-13
### Changed
- Blurred sidebar changed for both themes.
### Removed
- Settings for sidebar transparency and blur.

## v0.20.0 — 2026-09-13
### Added
- Blurred sidebar in the light theme.

## v0.19.0 — 2026-09-13
### Added
- Vim mode in Settings.
### Fixed
- Ghost notes in the graph.

## v0.18.0 — 2026-09-13
### Changed
- UX extended; some bugs fixed.

## v0.17.2 — 2026-09-13
### Fixed
- The graph forgot its state.

## v0.17.1 — 2026-09-13
### Removed
- Tasks folder.
### Fixed
- Context menu didn't work.

## v0.17.0 — 2026-09-13
### Added
- Text alignment; current note marked in the graph; more tooltips; sidebar extended.
### Fixed
- Highlight bug; quotes and code blocks look different.

## v0.16.0 — 2026-09-13
### Added
- Tasks section.

## v0.15.0 — 2026-09-12
### Added
- Full graph logic.

## v0.14.0 — 2026-09-12
### Added
- Properties in the editor.

## v0.13.0 — 2026-09-12
### Added
- More styling options; more settings.

## v0.12.0 — 2026-09-12
### Added
- Version history, with snapshots in SQLite.

## v0.11.0 — 2026-09-12
### Added
- Quick search.

## v0.10.0 — 2026-09-12
### Added
- Quick switcher.

## v0.9.0 — 2026-09-12
### Added
- Link logic.
### Fixed
- A big graph bug.

## v0.8.0 — 2026-09-12
### Added
- CodeMirror editor with styling.

## v0.7.0 — 2026-09-12
### Added
- Delete, archive and a Trash section.
### Changed
- The graph is a floating window.

## v0.6.0 — 2026-09-12
### Added
- Index: numbered migrations with a schema_version table; tables for notes, links, tags, properties, headings, events and full-text search; parser for frontmatter, headings, wikilinks and tags.

## v0.5.0 — 2026-09-12
### Changed
- Sidebar sections reorganised; graph moved to the right.

## v0.4.0 — 2026-09-12
### Added
- Read, write, create, rename, move and trash files, with atomic write-then-rename.

## v0.3.0 — 2026-09-12
### Added
- Left sidebar with Workspace, Home, Data, AI, Tasks and Graph sections.

## v0.2.0 — 2026-09-12
### Added
- Workspace tree, tabs, split, home, hotkeys and command palette.

## v0.1.0 — 2026-09-12
### Added
- First version: stack and architecture chosen.
