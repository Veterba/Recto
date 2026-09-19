# Recto

A local-first knowledge app. Your notes are plain markdown files in a folder you
choose — readable by anything, yours to move, back up, or delete.

**No account. No sign-in. No server.** Nothing is uploaded, there is no
analytics and no phone-home of any kind. The only thing that reaches the
internet is the AI chat, and only if you paste in your own API key.

Electron 44, React 19, CodeMirror 6 and SQLite. Developed and tested on macOS.

**Beta.** It is used daily and it does not lose notes. There is no download:
you build it from this repository, which takes two commands and leaves a real
app in your Applications folder. The graph is still being worked on, and what
is missing is listed plainly in [Not built yet](#not-built-yet).

---

## Contents

- [Install and run](#install-and-run)
- [First run](#first-run)
- [The window](#the-window)
- [Writing notes](#writing-notes)
- [Links, properties and search](#links-properties-and-search)
- [Writing tools: focus mode, syntax, style, authors](#writing-tools)
- [The graph](#the-graph)
- [Tasks board](#tasks-board)
- [AI chat](#ai-chat)
- [Templates and daily notes](#templates-and-daily-notes)
- [Obsidian sync](#obsidian-sync)
- [History, archive and Tidy](#history-archive-and-tidy)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Where your data lives](#where-your-data-lives)
- [Development](#development)
- [Not built yet](#not-built-yet)
- [License](#license)

---

## Install and run

There is no download — you build it yourself from this repository. Three
commands, and you end up with a real **Recto.app** in your Applications folder,
in Launchpad and in Spotlight like any other app.

### You need

| | |
|---|---|
| **macOS** | Where it is developed and tested. The window translucency and the spell checker are macOS features; everything else is plain Electron and should run on Windows or Linux, untested. |
| **Node 22 or newer** | Check with `node -v`. From [nodejs.org](https://nodejs.org) or `brew install node`. |
| **Xcode Command Line Tools** | For the first install only: the search index uses a native module that is compiled on your machine. `xcode-select --install` |
| **git** | To clone the repository. |

### Install it as an app

```sh
git clone https://github.com/Veterba/Recto.git
cd Recto
npm install      # also compiles the SQLite module against Electron
npm run app      # builds Recto and puts it in /Applications
```

That last command prints `Recto is in /Applications`. Open it from Launchpad,
from Spotlight, or with `open -a Recto`. Drag it to the Dock and it behaves
like anything else you installed — it does not need the terminal again, and it
does not need this folder to stay where it is.

**To update later**, pull and build again:

```sh
git pull
npm install      # only if the dependencies changed
npm run app      # replaces /Applications/Recto.app with the new build
```

`npm run app` always replaces the installed copy with the build you just made,
so what is in your Applications folder is whatever the code in this folder says.
Quit Recto before running it, or macOS will keep the old copy running.

### Or make a disk image, to give it to someone

```sh
npm run dist     # writes dist/Recto-<version>-arm64.dmg
```

Open the `.dmg` and drag Recto into Applications, the ordinary way. That is the
file to hand to a friend who does not want to build anything — with one caveat:
the app is **not signed by Apple** (that needs a paid Developer ID), and macOS
quarantines anything downloaded from an unsigned developer. It opens fine if
you built it yourself; if you downloaded it, run this once:

```sh
xattr -cr /Applications/Recto.app
```

Right-click → Open works too. Building it yourself avoids the question
entirely, which is why that is the route above.

### Or run it from source, to change it

```sh
npm run dev
```

This is the developer loop: it opens the app and reloads it as you edit the
code. It shares nothing with the installed copy except your vaults, so you can
have both. Closing the window or ⌘Q quits it.

### If `npm install` fails

It is almost always the native SQLite module.

```sh
xcode-select --install   # then run npm install again
npm run rebuild          # or rebuild just that module
```

`npm run rebuild` is also the fix if the app starts but search and the graph
stay empty and the terminal mentions `NODE_MODULE_VERSION`.

### Other commands

| Command | What it does |
|---|---|
| `npm run app` | Build and install into `/Applications`. |
| `npm run dist` | Build a `.dmg` in `dist/`. |
| `npm run dist:dir` | Build just the `.app` (no disk image), in `dist/`. |
| `npm run dev` | Run the app, reloading on changes. |
| `npm run build` | Type-check and build into `out/`. |
| `npm start` | Run the built app from `out/`. |
| `npm test` | Type-check and run the test suite (556 tests). |
| `npm run typecheck` | Types only. |
| `npm run rebuild` | Recompile the SQLite module against Electron. |

---

## First run

The app opens on **Choose a vault**. A vault is just a folder:

- pick an **empty folder** to start fresh, or
- pick a folder of **markdown you already have** — an Obsidian vault works, and
  is read exactly as it is.

Recto remembers it and reopens it next time. What it needs to remember about
that vault lives in a `.recto/` folder inside it, one small JSON file per
feature — see [Where your data lives](#where-your-data-lives).

To change vault later: **Settings → Vault → Open another folder…**, or pick one
from the recent list there. Open notes are saved to the old vault first.

---

## The window

- **Sidebar** — the vault's name, three sections, a search box, and the list.
  - **Data** (⌘1) — notes and folders.
  - **AI** (⌘2) — conversations with Claude, which are themselves notes.
  - **Tasks** (⌘3) — kanban boards whose cards are notes.
  - ⌘B hides and shows it. Right-click empty space in it to recolour it.
  - **Drag a row** to rearrange the tree: onto a folder puts it inside, between
    two rows puts it there — a line shows which. The arrangement is yours and is
    kept in `.recto/tree-order.json`; anything you have not arranged stays in
    the old order, folders first and then by name.
- **Tabs** — notes open in tabs, all the same width; middle-click or × closes
  one, **Clear all** is at the end of the bar, and a tab whose file is gone is
  dropped automatically. Split a pane with ⌘⌥→ or ⌘⌥↓.
- **Status bar** — the vault, what is open, today's note, the tab count, the
  graph toggle and the command palette.
- **⌘P — the command palette.** Every command in the app, searchable, each with
  its shortcut. If you remember one thing, remember this.

---

## Writing notes

The editor is CodeMirror 6 and **the file is the buffer**: nothing is converted
on open or on save, so what the file holds is what you see. Saving is automatic
and debounced; ⌘S flushes it immediately.

- **Live Preview** — markdown markers stay hidden until the cursor reaches their
  line. ⌘⇧P switches to plain source.
- **Markdown it understands** — everything an Obsidian note can carry, so
  copy-paste between the two loses nothing: headings, bold, italic,
  strikethrough, `==highlight==`, inline and fenced code (with language
  highlighting), quotes, callouts (`> [!note]`), bullet, numbered and task
  lists, nested lists with indent guides, tables, footnotes, `%%comments%%`,
  horizontal rules, LaTeX maths (`$inline$` and `$$block$$`, rendered with
  KaTeX), images, and embeds (`![[note]]`, `![[picture.png]]`).
- **Folding** — every heading and every list item with something under it gets a
  fold arrow in the margin. ⌘. folds the line the cursor is on, ⌘⌥[ folds
  everything, ⌘⌥] unfolds. Folds are remembered per note.
- **Outline** (⌘⇧O) — the note's headings beside the text; click to jump.
- **Note title** — the file name, editable above the text. Renaming it rewrites
  every `[[link]]` that pointed there. Can be switched off in Settings → Editor.
- **Images** — drag one in, paste a screenshot, or ⌘⇧I. The file is copied into
  `attachments/` and the note gets an ordinary `![](attachments/…)`.
- **Vim mode** — Settings → Editor, if you type that way.

---

## Links, properties and search

- **`[[wikilinks]]`** — type `[[` and pick from your notes. `[[Note#Heading]]`
  and `[[Note|alias]]` both work. Clicking one opens it; a link to a note that
  does not exist is drawn dashed.
- **Renaming** a note rewrites the links pointing at it, and tells you how many
  it changed.
- **Linked mentions** — at the foot of each note: what links here.
- **Properties** — the YAML frontmatter at the top of a note, edited as a table:
  text, numbers, dates, checkboxes, lists and links. Obsidian's block lists
  (`tags:` with `  - item` lines under it) are edited in place and written back
  in the same shape.
- **Go to note** (⌘O) — fuzzy search over note names.
- **Search all notes** (⌘⇧F) — full text through SQLite FTS5: `"exact phrases"`,
  prefixes like `obsi*`, and `tag:`, `path:` and `file:` filters. Results show
  the line that matched.

---

## Writing tools

After iA Writer. In the toolbar (the pen icon) and in Settings → Writing.

- **Focus mode** (⌘⇧↩, Esc to leave) — the sidebar, tabs, bars and panels fade
  away and only the text remains. Everything but the line you are writing dims,
  and that line stays in the middle of the window as you type. Move the pointer
  to the top for a floating toolbar with the formatting buttons, a word count
  and the way out. You can focus by **line, sentence or paragraph**.
- **Typewriter scrolling** (⌘⌥T) — keep the current line centred, with or
  without focus mode.
- **Syntax highlight** (⌘⌥S) — colours adjectives, nouns, adverbs, verbs and
  conjunctions, so a paragraph's habits become visible. English is tagged by an
  offline tagger on your machine; Russian is tagged by word endings and is
  approximate.
- **Style check** (⌘⌥C) — strikes through fillers, clichés and redundancies, in
  English and Russian. Nothing is rewritten: the words are only marked. Add your
  own list in Settings → Writing.
- **Authors** (⌘⌥A) — shows which text is yours, which came from an AI and which
  is a quoted reference. Everything is yours unless marked: **Paste as AI** is
  ⌘⌥V, or select text and use *Mark selection as…*. Typing inside an AI passage
  makes those words yours again. Marks live in `.recto/authors.json`, never in
  the note, so the file stays plain markdown.
- **Spell check** — optional; right-click a misspelt word for suggestions.

---

## The graph

⌘G opens it as a floating panel; its expand button fills the window, and the
command palette can open it as a tab.

- Notes are dots, links are lines, and the note you have open is highlighted
  along with its links.
- **Drag** a dot to move it — the rest of the graph keeps its shape while you
  do. Scroll to zoom, drag the background to pan; it glides rather than jumps.
- Buttons along the bottom: labels, unlinked notes, task cards, AI chats,
  **only this note's links**, centre on the open note, fit everything on screen.
- **At full size**, a round button on the right edge opens a wheel of sections:
  - **Layout** — organic, tree (growing down, up, left, right, or outward in
    rings), radial (busiest notes in the middle), circle, or one island per
    folder.
  - **Colour** — the same colour pad as the sidebar: one colour, several that run
    from notes with few links to your hubs, or one colour per folder; link
    colour; a tinted background with optional grain.
  - **Dots** — size range, glow, opacity, shape, and a **links-per-note filter**
    with a histogram of your vault.
  - **Nodes** — link thickness, opacity, curve, arrows, travelling "signals".
  - **Labels** — size, which notes get one, and the zoom they appear at.
  - **Forces** — repulsion, link length, link pull, centre pull.

---

## Tasks board

A kanban board whose **cards are real notes**, so a card holds anything a note
can, and moving one writes a single field in a single file. Columns live in
`.recto/boards.json`; the cards are notes in the vault, kept out of the file
list. Clicking a card opens it in the ordinary editor.

---

## AI chat

Bring your own Anthropic API key: **Settings → AI**. It is kept in your macOS
keychain (Electron `safeStorage`) — never in the vault, never in the app
bundle — and the renderer never sees it: requests go from the app's main process
straight to `api.anthropic.com`.

Conversations are saved as markdown notes in the vault, so they are searchable
and linkable like everything else. Choose the model in Settings → AI.

---

## Templates and daily notes

**Settings → Templates.**

- A visible folder in your vault (default `Template/`) holds your templates.
  Insert one at the cursor with **⌘⇧T**; its properties are merged into the
  note's own, without overwriting any it already has.
- Placeholders: `{{title}}`, `{{date}}`, `{{time}}`, `{{path}}`, and dated
  offsets such as `{{date:+1}}`.
- **Daily notes** — switch them on and pick a template, and today's note is
  created the first time you ask for it, at
  `Daily/2026/09/W38/2026-09-17.md` (year, month, ISO week, day), properties
  included. The calendar button in the status bar and **⌘⇧D** both open today's.

---

## Obsidian sync

**Settings → Obsidian** pairs the open vault with an Obsidian vault and keeps
the two in step, both ways: notes, folders and attachments. It finds your
Obsidian vaults for you, shows what the first sync would do before it does it,
and after that follows changes on either side.

- A file changed on both sides since the last sync is a **conflict**: both
  versions are kept — the newer one in place, the other beside it as
  `Note (Obsidian conflict 2026-09-17 10-32).md`.
- Deletions are mirrored, but a pass that would delete an unusual number of
  files stops and asks first.
- It does nothing until you pair a vault, and pairing is per vault.

---

## History, archive and Tidy

- **Version history** (⌘⇧Y) — snapshots of a note as you write it, with a diff
  and a restore. Kept in the vault's index database.
- **Archive** — deleted notes wait there (10 days by default, configurable in
  Settings → Vault) before going to the system trash, so a deletion stays
  recoverable both inside the app and in Finder.
- **Tidy** — the brush button above the file list. It looks at the loose notes at
  the top of your vault and proposes folders for them, based on their tags, their
  links and their names. **It only proposes:** you see every move first, and
  nothing happens if you cancel.

---

## Settings

⌘, opens Settings:

| Tab | What is in it |
|---|---|
| **Appearance** | Theme, window translucency, editor and heading fonts, heading scale, sidebar size and contrast, hover-preview delay |
| **Editor** | Live Preview, fonts, note title, Vim mode |
| **Writing** | Everything under [Writing tools](#writing-tools), plus how far unfocused text fades and your own style-check words |
| **Templates** | Templates folder, daily notes and their template |
| **Obsidian** | Two-way sync with an Obsidian vault |
| **AI** | API key and model |
| **Shortcuts** | Rebind any command |
| **Vault** | Switch vault, recent vaults, attachments, archive retention, rebuild the index |

---

## Keyboard shortcuts

`⌘` on macOS is `Ctrl` elsewhere. All of these are rebindable in
Settings → Shortcuts, and all of them are in the command palette.

### App and workspace

| | |
|---|---|
| ⌘P | Command palette |
| ⌘O | Go to note |
| ⌘⇧F | Search all notes |
| ⌘N | New note |
| ⌘B | Toggle sidebar |
| ⌘1 / ⌘2 / ⌘3 | Data / AI / Tasks |
| ⌘, | Settings |
| ⌘W | Close tab |
| ⌃Tab / ⌃⇧Tab | Next / previous tab |
| ⌘⌥→ / ⌘⌥↓ | Split pane right / down |
| ⌘G | Graph panel |
| ⌘⇧Y | Version history |
| ⌘⇧D | Today's note |
| ⌘⇧T | Insert template |
| ⌘⇧L | Cycle theme |

### Editing

| | |
|---|---|
| ⌘B / ⌘I | Bold / italic (with the editor focused) |
| ⌘E | Inline code |
| ⌘⇧X | Strikethrough |
| ⌘⇧H | Highlight |
| ⌘K / ⌘⇧K | Link / link to a note |
| ⌘⇧1 … ⌘⇧6 | Heading 1–6 |
| ⌘⇧8 / ⌘⇧7 / ⌘⇧C | Bullet / numbered / task list |
| ⌘⇧9 | Quote |
| ⌘⇧E | Code block |
| ⌘⇧M / ⌘⌥M | Inline maths / maths block |
| ⌘⇧- | Horizontal rule |
| ⌘⇧I | Insert image |
| ⌥↑ / ⌥↓ | Move line up / down |
| ⌘S | Save now (saving is automatic anyway) |
| ⌘F | Find in note |
| ⌘. | Fold or unfold this heading or item |
| ⌘⌥[ / ⌘⌥] | Fold / unfold everything |
| ⌘⇧O | Outline |
| ⌘⇧P | Live Preview on / off |

### Writing tools

| | |
|---|---|
| ⌘⇧↩ | Focus mode (Esc leaves it) |
| ⌘⌥T | Typewriter scrolling |
| ⌘⌥S | Syntax highlight |
| ⌘⌥C | Style check |
| ⌘⌥A | Show authors |
| ⌘⌥V | Paste as AI text |

---

## Where your data lives

| What | Where |
|---|---|
| Your notes | the vault folder you picked — plain `.md` files, nothing else |
| Images you paste or drop | `<vault>/attachments/` |
| App state for that vault | `<vault>/.recto/` — `appearance.json`, `workspace.json`, `graph.json`, `writing.json`, `templates.json`, `boards.json`, `archive.json`, `hotkeys.json`, `authors.json` |
| Search index and version history | `<vault>/.recto/index.db` — **a cache.** Delete it and it rebuilds from your files; you lose version history, which cannot be rebuilt. |
| Deleted notes | `<vault>/.recto/archive/` until they expire |
| Your Anthropic API key | your OS keychain, via Electron `safeStorage`. Never in the vault, never in the bundle. |
| Last-opened vault, recent vaults, Obsidian pairing | your user app-data folder (`~/Library/Application Support/Recto/`) |

A vault is safe to put in git: no keys, no absolute paths. `.recto/` carries a
`.gitignore` that keeps the index out.

---

## Development

```
src/main/        Electron main: window, vault, files, watcher, sync, AI, secrets
src/preload/     one allowlisted `invoke`, nothing else
src/shared/      the typed IPC contract, imported by both sides
src/indexer/     SQLite + FTS5 in a utility process, numbered migrations
src/renderer/    the React app
  core/          workspace, commands, hotkeys, appearance, templates, writing
  editor/        CodeMirror: live preview, folding, writing tools, authorship
  components/    sidebar, tabs, dialogs, colour editor, sliders
  graph/         layouts, canvas renderer, physics worker, settings wheel
  views/         note, settings, first run, the shell
test/            556 tests, vitest
build/           app icon, and the two hooks electron-builder calls
electron-builder.yml   how the .app and .dmg are assembled
```

House rules, worth knowing before sending a patch:

- **The renderer has no Node access.** `contextIsolation: true`,
  `nodeIntegration: false`; everything crosses through the typed contract in
  `src/shared/ipc-contract.ts`.
- **Every path is contained** with `path.relative`, never `startsWith`.
- **The index is a cache.** Nothing may live only in SQLite — the files are the
  truth.
- **Tests cover logic, not pixels**: links, paths, layouts, parsing, merging,
  mapping. `npm test`.
- **Packaging is a build step, not a checklist.** `build/icon.svg` is the
  source of the icon (`icon.png` and `icon.icns` are generated from it), and
  the native SQLite module is kept outside the asar archive because a compiled
  binary cannot be loaded from inside one. If you touch either, check the
  packaged app and not just `npm run dev`.

---

## Not built yet

An honest list:

- **Not signed by Apple, and there are no automatic updates.** `npm run app`
  builds a real app and installs it, and `npm run dist` makes a `.dmg` you can
  hand over — but the signature is ad-hoc, so a `.dmg` someone *downloads*
  needs `xattr -cr` once. A Developer ID (£/$99 a year) and `electron-updater`
  are what turn this into a download-and-forget install; neither is done.
- **The build is for the machine that builds it.** `npm run app` on an Apple
  Silicon Mac makes an Apple Silicon app, because the SQLite module is compiled
  locally. That is fine when everyone builds their own; a universal binary is
  not set up. Windows and Linux targets are configured but have never been run.
- **No mobile, no plugin API, no multi-window.**
- **Graph:** an outward tree of a very large vault still bunches near the middle,
  and the circle layout only reads well if your folders match your topics.
- **Search does not know Obsidian's block-list tags yet** — they are shown and
  editable in Properties, but `tag:` search does not find them.
- **Russian syntax highlight is approximate** (word endings, not a tagger).
- **Sync does not carry empty folders.**
- Collapsible callouts, transclusion, block references and mermaid diagrams are
  not implemented.

---

## License

MIT — see [LICENSE](./LICENSE).
