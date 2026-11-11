# Changelog

Entries up to v0.47.1 were reconstructed on 2026-10-15 from git commit messages (the original log was
lost). They say only what the commit messages say. Versions with internal changes only (refactors,
merges, tooling, README and CLAUDE.md edits) are left out.

## v0.60.3 — 2026-11-11
### Fixed
- When Obsidian or a sync app writes a note while you are typing in it, both changes are kept if they touch different lines. If they touch the same line, your typing stays, the note says so, and the other version is in History. Before, the other app's version replaced what you had typed.
- Text typed in a canvas card is saved when its tab is closed while you are still editing it.
- With a Japanese, Chinese or other input method, Enter and Escape while composing no longer send, close or jump; they finish the composition.
- Checkboxes, links, highlights and maths are no longer drawn inside code; code shows as written.
- Links and tags inside inline code, and in a code block whose fence is longer than three backticks, are no longer counted as links and tags. The index is rebuilt once to drop the old ones.
- A note starting with a byte order mark (from some Windows apps) has its frontmatter read; boards and cards saved that way work.
- Undoing a rename keeps the note's version history, authorship and canvas layout.
- A note archived while another was being restored or purged no longer disappears from the archive list.

## v0.60.2 — 2026-11-10
### Changed
- An edit AI suggests in a chat shows right under the answer that made it, in the chat panel and in Quick ask, with Apply and Discard there - and, once settled, whether it was applied, discarded or went out of date.
- Suggested edits looks like the rest of Recto: a glass panel like Settings, without a backdrop, each suggestion with its note's name, what kind of change it is, who suggested it and how long ago, and the change in the note's own font with added and removed lines marked. Apply all and Discard all when several wait; a suggestion settled there stays with what became of it until the panel is closed.
- "What do I have on Friday?", "tomorrow" and "next week" look ahead; a past question still means the day before.

### Fixed
- While a next question is typed during an answer, Stop stays beside Send, and Esc stops the answer.
- An error from one chat topic no longer shows under another.
- AI settings can no longer be saved before they have loaded, which could reset the excluded folders.
- A Claude Code or Codex that stops early no longer crashes Recto. Quitting Recto also stops Quick ask's answers.
- Claude Code gets Recto's instructions and your AI guide from a file, not the command line, and runs without your own Claude Code hooks and plugins.
- AI edits keep a note's Windows line endings, and an edit copied without them still finds its place.
- The AI activity log no longer keeps the text of canvas cards, headings or searches. Write directly's backups are kept 30 days.
- "Late" no longer matches "template"; a task topic nothing mentions is said so; «в среду с Колей» is one day, not a range.
- The eval's checks: "not in the vault" no longer passes on «Интернет» or on a "not found, but…" that answers anyway, and a small number must be in the notes to count as grounded.

## v0.60.1 — 2026-11-10
### Fixed
- Plan limits no longer show an old reading as current: a window that has reset since is left out, and a reading more than an hour old says when it was taken. Claude Code reports its limits only with an answer, so "27% of 5 hours · resets 02:10" could stay for days after that window had reset.
- The installed app and a development build show the same plan limits and the same tokens: both keep them in one file.
- "Recto used … this week" counts since Monday, as the overview does, not the last seven days.
- A busy or slow moment at OpenAI no longer signs you out of ChatGPT. Only a sign-in OpenAI has ended asks you to sign in again. Settings and the model picker no longer wait forever on a request that hangs.
- A greeting with a question in Russian or Norwegian («Привет, что нового?», «Takk, når er løpet?») is answered from your notes, not as small talk.
- "What is today's plan?" or "What's the date of the race?" are answered from your notes; only a question about today's date itself gets the date.
- An answer stops when you switch vaults or turn cloud providers off while it runs, and nothing it finds after that is sent anywhere.
- AI can no longer make a note or a canvas in a folder excluded from AI, or learn from the refusal what that folder holds. Recto's own folders and excluded folders are matched in any case and any Unicode form, as the Mac matches names.
- A malformed message to Recto's MCP server is passed over instead of stopping the app.
- Quick ask evals use the cases' own date, and their report lists each note once.

## v0.60.0 — 2026-11-10
### Added
- Each answer from a cloud provider - in Quick ask and in the chat - keeps a record of what it really did: the notes it read in full, the ones it only skimmed, and the edits it suggested. The model gets it back with every later question, so it no longer takes back a read or an edit that happened, and does not suggest an applied edit again.
- Quick ask says when an answer claims an edit waits for Apply and none was made: "No edit was created".
- An eval for Quick ask (`npm run bots:eval -- --quick-ask --model claude-code`): conversations about one note, turn by turn, with suggestions applied between turns as a person would.

### Changed
- "Looked through N notes" counts the notes the answer read in full, each once; with none, "Skimmed N notes". A note cut short, a summary, a search hit or a PDF page range is skimmed, not read.
- An answer's sources are the notes it read in full, not every search hit it saw.
- "Review the suggested edit" in Quick ask shows while one of the conversation's suggestions waits for Apply, and goes when it is applied or discarded.
- A stopped Quick ask answer is marked "Stopped", is left out of the next question, and is saved as interrupted.
- Eval results, fixture runs too, are written only to the vault set by `RECTO_EVALS_VAULT`, never to the repo.

### Fixed
- Quick ask no longer sends an earlier answer that used a note excluded since to a cloud provider.
- The AI guide is no longer given to AI when its folder is excluded.
- A Quick ask question that could not be sent ends with a message instead of answering forever.

## v0.59.4 — 2026-11-09
### Fixed
- A `tasks` folder no longer appears in the root of the vault. When the boards migration ran again in a vault already in today's layout - its record lost, or an old boards.json synced back - it made its board in `tasks/` and left it there. Boards it makes now go straight into `Recto/Boards/<Board>/`.
- A migration's record that iCloud renamed to "… 2.json" still counts, so the migration does not run again and strip `board:` keys from notes.
- A file Recto makes itself - a card, a chat, a note brought back by Undo - shows in the file tree at once.

## v0.59.3 — 2026-11-09
### Changed
- Words written in the overview are how far the vault's words moved: everything that is in the vault counts, whoever wrote it - you, an AI, a paste - and deleting or archiving takes words off, so a day can show "−120 today".
- The overview's Words total counts every note, boards and their cards and chats included. Obsidian's `%%comments%%` are left out, a board's settings among them. The index is rebuilt once to recount.
- Time in Recto is counted per vault and kept in the vault: the installed app and a development build add to the same figure, and other vaults' time no longer shows. It starts again from today.

### Fixed
- The vault's word count for a day kept starting over with each count, so a day's change was always zero.

## v0.59.2 — 2026-11-08
### Changed
- In a table cell, ⌥← ⌥→ move by word and ⌥⇧← ⌥⇧→ select by word, as in any Mac text. Moving a column is now ⌃⌥← ⌃⌥→ (⌥↑ ⌥↓ still move the row).
- The overview says its time figures are per day: "a day in Recto this week · 39 min a day last week".
- Settings opens taller, so the whole list of sections shows without scrolling.

### Fixed
- Quick ask (⌘J) opens with its field focused. The question used to be typed into the note.
- Typing in a property keeps every key and space: the value is written when you press Enter or leave the field, and Esc drops it. Home and End move within the field instead of scrolling the note away.
- A card changed on a board shows at once in its open note, and that note's next save no longer puts the old value back.
- Accept all with several AI suggestions on one canvas keeps them all, as one change ⌘Z takes back. It used to keep only the last.
- ⌘Z right after a paste on a canvas takes the pasted node away. It used to do nothing, and the next ⌘Z took back the change before it.
- With a drawing open to edit, keys typed in the chat box or another field stay there. ⌘A and Backspace in the chat used to delete the drawing.
- Tags in a note's properties (tags: [garden, herbs]) count as tags, as in Obsidian: the overview, Settings → Vault and the graph showed none. The index is rebuilt once to pick them up.
- A note embedded in a numbered list (2. ![[Note]]) keeps its label inside its card, clear of the number.
- Tidy's preview takes focus when it opens, so Esc closes it.
- A task shows only its checkbox, without a bullet beside it, as in Obsidian.
- A formula alone on its line ($$…$$) is centred, as in Obsidian.
- A board column no longer stays outlined in blue after a file is dragged over it, or a card is dragged over it and away: only a card lights a column, and only while it is over it.
- A card's "soon" mark and the Due soon widget count the same three days ahead. The mark used to stop at two, so a card in the widget could be unmarked.
- A file whose name contains ".tmp-" (notes.tmp-ideas.md) shows in the tree and the index. It used to be taken for one of Recto's temporary files and skipped.
- Words written no longer grow when you undo a deletion or paste back text you cut a moment before. Each used to count as newly written.
- A table starts at the text column, in line with the text above and below and with a selection. It sat a little out to the left.
- A board or canvas with a long name keeps its icon in the sidebar list, and the name ends in "…". The icon used to shrink to a dot or vanish, worst on hover.

## v0.59.1 — 2026-11-07
### Added
- Links to canvases work as in Obsidian: the [[ list offers your canvases beside your notes, with a canvas icon, and picking one writes [[Name.canvas]] in your link format. In the editor the link shows the canvas's name without ".canvas"; the text keeps it.

### Fixed
- A link with an alias, such as [[Japan moodboard.canvas|Japan moodboard]] or [[Kyoto|the city]], opens what it points at. A click, ⌘-click or drag used to follow the alias and find nothing.
- Quick ask no longer says that a linked note is missing when it exists. It is told which of the note's links point at a note and which at nothing, also for notes it may not read from there.
- Hovering a link to a canvas or another file that is not a note shows no preview card, instead of the file's raw text.

## v0.59.0 — 2026-11-06
### Added
- AI on the canvas, as suggestions you see in place: an AI's changes to a canvas - new cards, notes, files and links, arrows, groups, moves - appear as translucent ghosts with ✓ and ✕ each, and Accept all / Reject all at the top. Nothing is written until accepted; an accepted change goes in as an edit ⌘Z undoes, onto the canvas as it is then (a change whose node you deleted since is skipped). Suggested edits lists a canvas's changes as one line, with "Open to review".
- Canvas tools for AI apps and Recto's chats: canvas_list, canvas_read (nodes by short ids, n1, n2…), canvas_propose_nodes, canvas_propose_edges, canvas_propose_group, canvas_propose_layout and canvas_propose_new. The AI says what goes together; Recto works out where, never over what is there (a group whose frame would take in other nodes gathers its own first).
- Quick ask on a canvas can now suggest changes to it, shown as ghosts.
- Canvas commands, from a node's or a selection's right-click menu: Group these, Brainstorm around this, Map this note and Arrange as moodboard ask Quick ask, their changes coming back as ghosts; Turn into a board makes a group a board (its cards and notes in order) and puts it beside the group; Show board as canvas lays a board out as a new canvas, a group per lane.
- The AI sees pictures: read_file sends a picture itself (made smaller when large) to a provider that can see - Claude and OpenAI through their APIs, Claude Code and Codex through Recto's AI tools. Recto's local model gets its name and size, as before.
- A pen panel over the tool bar while Draw is on: pen or highlighter, four sizes and six colours (or any colour) each, kept for next time. A highlighter is flat, wide and see-through, and sits under what it marks - in the SVG too, so Obsidian shows it the same.
- Draw and hold: draw a line, an arrow, a triangle, a rectangle or an ellipse and hold the pen still for a moment - it snaps to the clean shape. Let go at once and the stroke stays as drawn.
- Double-click a drawing to edit its strokes: click one or drag round several, then move them, resize them from a corner (⇧ keeps proportions), recolour or delete them; ⌘Z and ⇧⌘Z within the edit; "Draw here" adds strokes to it; Esc finishes.
- An eraser panel while Erase is on: Cut (the default) takes out only what the eraser passes over, leaving the rest of the stroke as pieces; Whole strokes takes every stroke it touches.

### Changed
- Strokes feel like a pen: every point the system reports is kept (fast strokes keep their shape), a pen with pressure draws with it, a mouse or trackpad gets tldraw's simulated pressure, and strokes are never tidied behind the hand.

## v0.58.0 — 2026-11-06
### Added
- The AI reads every file in the vault it may see, not only notes: a new read_file tool for Quick ask, the chats (cloud and local) and AI tools (MCP) reads a PDF's text page by page, text and code files in parts, canvases (cards, notes, files, groups, arrows) and a picture's name and pixel size. A file in a folder AI may not see is "no file"; a name several files share is asked about; what it cannot read yet (.xlsx, .docx) is said.
- Quick ask works on a canvas: what is selected there - a group with everything in it - or the whole canvas goes with the question, with the start of each note on it; a note in a folder AI may not see is there only as a place, never its name or text. Files on it are read with read_file. It reads; it does not change the canvas yet.

### Changed
- The floating bot shows on boards too, on a frosted disc that blurs the cards behind it.

### Fixed
- Every stroke is a drawing of its own, however soon it follows the last one; double-click a drawing to draw more on it. Strokes no longer merge into a drawing they are drawn over.
- The eraser finds a stroke wherever it crosses it - line against line - and is the same size on screen at any zoom; zoomed out it used to slip between a stroke's points.
- A card name being typed with a space at the end no longer warns that it won't work on Windows: names are saved trimmed.
- The choice for a card name several notes have is a list of full-width rows, no longer squeezed into narrow columns.

## v0.57.0 — 2026-11-05
### Added
- Notes in different folders may share a name, as in Obsidian; a folder holds one file of a name (in any case).
- A warning under the name field, before anything is made, for names with `# ^ [ ] |` (links will not find them), names Windows cannot hold (`* " < > ? |`, or ending in a dot or space) and names starting with a dot. The name is never changed. It shows in the tree's rename and new dialogs, the note title, new card and card title, new and renamed boards and canvases, Make it a note, the canvas Note picker and New tab.
- Links resolve as Obsidian resolves them, read from the note they are in: `/path` from the vault's top, `./` and `../` relative to the note, an exact vault path first, else a same-named file in the note's own folder or below, then the shorter path, then the file made first. Checked against Obsidian 1.15.0 on a test vault: all 92 links from 5 folders open the same file in Recto (e2e test).
- Links to pictures and other files that are not notes resolve too; they used to count as broken.
- Links are written as Obsidian writes them, following the vault's Files and links settings in `.obsidian/app.json` (new link format shortest, relative or absolute; `[[Wikilinks]]` or Markdown links): the name alone when no other note has it, else the path. This covers the `[[` suggestions, links in properties, the chat composer, dropped and pasted pictures (embedded as Obsidian embeds them, `![[image.png]]` by default), board cards, Copy link in the tab menu, the week, month and year links of periodic notes, and AI (MCP) edits.
- The `[[` suggestions list each same-named note as its own row with its folder; the one you pick is linked by its path.
- A Files and links tab in Settings, under Vault, shows Obsidian's three settings for this vault. It is read-only; change them in Obsidian.
- Overview, Needs attention: a "Links that depend on file dates" row lists links whose note was chosen only because one same-named file was made first (equally near, equally long paths). Creation dates change on copy, git clone or some syncs, so another Mac can open the other note (Obsidian too). Each row says which folder it opens on this Mac.
- Linked mentions shows the folder next to linking notes that share a name.
- Board "+ card" with a name another folder has asks instead of guessing: "Create a new “X” on this board" (the default, Enter) or "Use the one in <folder>" for each existing note. The existing file never moves. If the board's own folder has the name: "Add it to this board" or "Choose another name". The same on a board drawn on a canvas.
- Canvas "Make it a note" with a taken name offers "Use that note" (puts the existing note on the canvas; the file stays where it is) or "Create a new “X” here", and "Choose another name" when the target folder has it. The canvas Note picker puts an exact name match first, so Enter picks it.
- AI tools (MCP): a note given by a name several notes share is answered with the list, so you give it by path; a new `[[link]]` with such a name is refused with the exact links to write; the rule text the AI reads now describes Obsidian's rules.

### Changed
- Only `\ / :` are refused in a name, with Obsidian's message.
- Renaming or moving a note, folder, board or card writes again every link that pointed at it, for its new place and in the vault's format, keeping alias, `#heading` and `!`. A moved note's own relative links still point where they did, and links in code blocks are left alone.
- When the vault's "Automatically update internal links" is off (Obsidian's default), a rename or move asks Obsidian's "Update links" question: Always update (turns the setting on in `.obsidian/app.json`, or in `.recto/link-settings.json` for a vault Obsidian never opened), Just once, or Do not update. A board rename asks once for all its cards; Recto's own tidying moves never ask.
- A card line on a board resolves from the board's own folder first, so a new card is never silently linked to another board's card of the same name.
- New boards may share a name with a note elsewhere.
- Today's note, and the week, month and year notes, are made in their own folder even when another folder has a note of that name.
- A new note's name through the AI tools only has to be free in its folder.

### Fixed
- The Suggested edits dialog sometimes did not open after a proposal; it opened and shut at once.

### Removed
- The rule that note names are unique in the whole vault, and its refusals.
- The "Recto README" fallback name: Recto/README.md is made whatever README exists elsewhere (an existing Recto README.md still counts).

## v0.56.0 — 2026-11-04
### Added
- Canvases: a `.canvas` file (JSON Canvas) opens as a plane you pan and zoom, and Obsidian opens the same files. Keys Recto doesn't know and plugin nodes are kept as they are, and a change rewrites only that node's own line, in the layout Obsidian writes.
- The Canvas section lists every canvas in the vault, the one changed last first, filtered by the sidebar's search box. "New canvas" makes one in Recto/Canvas, where Recto keeps canvases (out of the Data tree, as boards are), and refuses a name that is already taken. Canvases found anywhere else are listed with an offer to move them there - nothing is moved unasked - and links to them follow the move. A note made from a canvas goes to the vault's top level unless you choose a folder, never into Recto/.
- Text nodes are edited with the note editor (double-click) and shown as rendered Markdown. Double-click on empty space makes a new one; dragging from a node's side into empty space makes a new one joined to it.
- A note on a canvas shows its text and can be edited right there; the change is saved to the note with its properties left alone. Double-click the title to open the note.
- Cards and boards on a canvas: a card shows its status, priority and dates, and its right-click menu has Mark done, Move to a lane, priority and due date, written the way the board writes them. A board on a canvas is a preview of its lanes - side by side when the node is wide, stacked when narrow - with its cards as chips (priority, dates, "+N more"); a chip's circle marks the card done, a click opens it beside the canvas, and a lane's + adds a task to it, named in place (a name a note already has says where that note is and offers to add it). Its name bar switches it to its Markdown (editable like any note, Obsidian's `%%` comments hidden) and back, remembered per canvas, and opens the board.
- Images and audio show or play on the canvas, and a video shows its first frame with a ▶ button (see below). A file that is gone says so, and its node stays.
- A PDF on a canvas is a preview of its pages and highlights, scrolled inside its node; a double-click opens it in the PDF panel, docked on the window's right as the AI panel is (beside it when both are open) - closed with ✕, its left edge dragged to make it wider, the width kept - in Recto's own PDF reader (also used for any PDF opened in a tab): pages drawn as they come into view, zoom (− / % / +) and the page count in a bar, and text to select. Select text and press Highlight to mark it; a click on a highlight in the reader removes it, and the canvas's preview shows the same highlights. Highlights are kept in `.recto/` by the PDF's path (the PDF is never changed) and follow it when it is renamed or moved. The page count is shown, and the node opens at its `#page=N`.
- A text file (.txt, .csv, .json, code) on a canvas shows its first lines; double-click puts the code editor in the node, which saves as you type and takes changes made elsewhere, and Escape or a click elsewhere ends it. Any other format is a card with its name, Open (in the app the Mac has for it) and Reveal in Finder.
- Link nodes show the page's title, description, picture and icon. The page is fetched once and kept, so the canvas never asks again, and only from the public web (never this Mac or the local network); offline, the link is shown without a preview.
- Groups hold the nodes inside their frame, move them when dragged, and fold to their label with a count. ⌘G draws a group round the selection. Notes fold to their name. Folds are remembered in `.recto/`, not in the canvas file.
- Arrows are drawn as in tldraw: each end is pinned inside its node and the arrow is cut at the node's border; drag the middle to bend it (double-click the handle to straighten it); drag an end onto another node or out into empty space, where it stays free. Arrows have a label, a colour and a head at neither end, the end or both. An arrow Obsidian made keeps its curve, and Obsidian still draws the ones made here, between the sides that face each other. An edge between two notes shows a link mark when the first note already links to the second.
- "Make it a note" on a text node makes a note from it, named from its first line (a heading line becomes the name and is not repeated in the text), in a folder you choose from a searchable list on a glass card (beside the canvas to start with), and puts it in the node's place with its size and colour kept. A name a note already has offers that note instead.
- "Make it a link" on an edge between two notes adds `[[the second note]]` to the first as a Suggested edit with a diff; nothing is written until you Apply.
- Editing: trackpad scroll pans one to one, pinch or ⌘-scroll zooms (without animation), Space or the middle button drags, and there are no background dots; click, ⇧-click and a dragged box select; nodes snap only to the edges and centres of other nodes, with guides (hold ⌘ while dragging for no snapping), and there is no grid; align, distribute, bring to front and send to back; copy and paste between canvases (new ids, edges between the nodes kept) and duplicate; ⌘F searches the canvas; right-click menus on nodes, edges and empty space, with colour swatches.
- A tool bar at the bottom of a canvas: Select (V), Hand (H), Arrow (A), Text card (T), Note (N: find a note or make one by typing its name), Board (B), Image, video or file (a dialog; the files are copied into attachments), Square (R) and Frame (F). A tool that puts something down works once, then it is Select again.
- Squares: a text node drawn as a square, its text inside, stored the way the Advanced Canvas plugin stores shapes. Shapes that plugin makes in Obsidian (circle, diamond, pill, parallelogram and others) are drawn too, their text under them (or above, from the style bar).
- A style bar floats above what is selected: colour (presets, none, or any hex), and for cards and shapes fill, border, text size and alignment; for arrows line style, thickness, arrowheads and Straighten. Border, alignment and line style are kept as the Advanced Canvas plugin keeps them; fill, text size and thickness are Recto's.
- A card grows with its text while you type in it, up to a limit, and the new height is saved with the text as one Undo step.
- "Open beside the canvas" on a note node opens the note in the pane next to the canvas, splitting the tab when there is no other pane.
- Pictures and videos keep their proportions when resized and are put down in their own proportions; a caption can be added under either.
- A task opened from a canvas (a card node, or a `[[task]]` link in a note or board on it) shows its card on the right of the canvas, the same panel as on its board, without leaving the canvas.
- Pictures and videos from Finder play from the vault as they should: a movie whose index is at its end (a screen recording) plays, and one that can't be shown says so, with Reveal in Finder, instead of saying it is not in the vault.
- Draw on a canvas with the pen (P): the pen stays on until Esc; strokes near each other make one drawing, and a stroke is a little tidied when it ends - a nearly straight line straightened, a nearly round shape rounded, handwriting smoothed, never by the whole way. A drawing is an SVG file beside the canvas ("<canvas> drawings"), so Obsidian shows it as a picture; Recto keeps its strokes in it, so a double-click draws on it again and the eraser (E) takes strokes away.
- Text (T) puts words on the canvas with no card round them; the text card moved to C.
- Zoomed far out, a PDF shows only its first page and a board only its lanes with their counts, so big canvases stay light; notes and text keep their text.
- Paste a web address on a canvas, or drag a link in from the browser: it becomes a link card with the page's preview, and a YouTube address becomes a video preview.
- A YouTube link is a video: its picture and title with a ▶ button, and nothing is loaded from YouTube until you press ▶.
- ▶ on a YouTube link or a video file opens a small mini-player window, always on top at the bottom right of the screen, that you can move and resize; one window is reused for the next video. Nothing plays inside the canvas, and a video node is dragged like any other node.
- The mouse wheel over anything that scrolls on a canvas - a note's or card's text, a PDF, a board - scrolls only that, even at its end; over anything else it moves the canvas. Pinch always zooms. Zoomed out below 45%, a card keeps its look and shows its text as plain lines without Markdown formatting, instead of a blank box.
- Resizing is easier: the grab area on a node's borders is 12 px wide, and corners are larger.
- The Canvas list in the sidebar has a right-click menu (Open, Rename, Copy relative path, Copy full path, Reveal in Finder, Move to archive, which asks first) and an × on hover; a new canvas shows in the list at once.
- Undo and redo (⌘Z, ⇧⌘Z) on a canvas, up to 200 steps, putting back only what that step changed. Deleting a note's node says "Remove from canvas" and never deletes the note.
- Drag a note, image or file from the tree onto a canvas. Files dropped from Finder, and images pasted, are copied into attachments and placed where you dropped them.
- A note's Linked mentions list "On canvas <name>" for each canvas it is on.
- Renaming or moving a note, or a folder, follows it on every canvas that has it, in the same Undo as the links that were rewritten.
- A note that is deleted keeps its place on the canvas, marked as gone, and the vault overview lists it under "Needs attention" as "Missing notes on canvases".
- The graph shows canvases as diamonds, tied to the notes on them by dashed lines, with a Canvases switch (on by default); two notes joined by an edge on a canvas are tied by a dashed line too.
- The vault overview has a Canvases total, shown once the vault has one.
- A change made in Obsidian or by sync while a canvas is open shows up, and a save made after it is applied to the file as it now is instead of writing over it. A save that fails is undone on screen with a notice.
- Big canvases stay light: only the nodes on screen are drawn, and zoomed out far enough cards show plain lines instead of formatted text, and the text of notes is kept per vault revision so panning back doesn't read them again. A generated 500-node canvas opened in 270–300 ms and panned at 45 fps (worst frame 50 ms) in the end-to-end performance test.

## v0.55.1 — 2026-11-03
### Changed
- The Chats panel opens straight on Recto's chat: the list of bots above it is gone, and other bots, when there are any, are in the chat's ⋯ menu.
- The AI guide (Settings → AI) is picked by typing a note's name, from your notes only, instead of a menu of every file in the vault.
- The floating bot is not shown on boards, where the lanes and the card panel leave no corner free; ⌘J still opens Quick ask there.

### Fixed
- The floating bot moves at once when you switch between a note and a page without Linked mentions, such as a new tab, instead of a moment later.
- "Ollama not running · ollama serve · Check again" stays on one tidy line instead of breaking mid-word.
- Two blue lines no longer appear at the sides of the active tab after a key press.
- "Show the floating bot" in the chat's menu and "Show board" over a board's Markdown stay on one line.

### Removed
- The "Comments — later" placeholder in a card's panel.

## v0.55.0 — 2026-11-02
### Added
- Recto's chat and Quick ask can answer with another provider than the model on your Mac, picked in the composer's model menu: Ollama on this Mac (the default), Codex CLI, ChatGPT plan (Preview), Claude Code (Experimental), or an OpenAI or Anthropic API key. The menu groups the cloud by maker - Anthropic, OpenAI - each with its own page of ways in and models. Settings → AI → Providers shows each one's state and signs in; the keys are under "Advanced · API keys".
- Plan limits where the provider reports them: Codex's windows (read without spending anything) and Claude Code's 5-hour and weekly windows (after its first answer), with when they reset, in the model menu and in Settings. For every provider, the tokens Recto used today and this week. Every answer remembers which model wrote it, the composer says "cloud" or "on this Mac", and switching provider mid-chat shows "Switched to …".
- Cloud is off for each vault until you turn it on in Settings → AI → Providers. Background work (note cards, tasks, topic titles) and the other bots always stay on your Mac.
- Codex CLI and Claude Code are found automatically (shell PATH, Homebrew, npm, bun, volta, pnpm, nvm, and the Codex CLI inside ChatGPT.app). They run with their own tools turned off and see your vault only through Recto, so Recto's rules, excluded folders and Suggested edits apply. Claude Code shows a one-line warning that Anthropic does not bless using a subscription through other apps; an API key is the supported way.
- Sign in with ChatGPT inside Recto (browser sign-in; tokens kept in the macOS keychain, sign-out revokes them). Plan limits, a plan that does not include it and a service outage each get their own message, with "Manage usage" for limits.
- Clear states for a missing CLI (with an Install link), not signed in, an expired sign-in, a plan limit, a provider that is down and cloud being off (with "Turn on"). Cancelling stops the answer mid-way.
- Chats panel on the right (⌘⇧C, or the button in the top-right of the tab bar, which steps aside while the panel is open): your bots, then the chat of the one you pick. It can be resized (never so narrow that a model's name is cut off) and remembers its width. The panel and the graph take turns on the right.
- A + after the last tab opens a new tab: one field to open something in it or name a new one ("Create “…”", ⌘↵) - notes in Data ("New note" and the notes edited lately below), boards in Tasks. What you pick takes the new tab's place, and ← comes back to it.
- Floating bot (the bot button in the status bar, ⌘⇧B, or the chat's ⋯ menu): Recto's bot floating over the page, no button around it; drag it and it snaps to the nearest edge and remembers its place, never onto a note's Linked mentions. ⌘⇧H hides and shows all floating windows and the bot.
- Quick ask (click the floating bot or press ⌘J): a bubble out of the bot to ask about the note you have open, showing which note goes with the question, with Copy and Save as chat; follow-up questions go in the same bubble. Each question carries that note and the notes it links to; answers use only those, and edits to that note arrive as Suggested edits. The thread is forgotten when closed and never saved in History; "Save as chat" moves it into the Chats panel.
- Canvas in the top switcher, next to Data and Tasks, as a "Coming soon" placeholder.
### Changed
- A note's text keeps a margin that grows with its pane, so beside the Chats panel it no longer runs to the pane's edge.
- Linked mentions, closed, is as tall as the sidebar's footer, so the two read as one row along the bottom.
- Chats are no longer an "AI" section in the top switcher; they live in the Chats panel.
- Excluded folders now also apply to Recto's own local chat (they already did for AI clients), and answers whose sources are in an excluded folder are never sent to a cloud provider.
- Anthropic models are now Opus 5.5, Sonnet 5.5 and Haiku 5.5; chats using the older ones carry over.

## v0.54.0 — 2026-11-01
### Added
- Recto is an MCP server: Claude Code, Codex, Claude Desktop, Cursor and other AI clients can work with your vault through Recto, with 19 tools: search by words and by meaning, read a note, a note with short summaries of the notes it links to and that link to it, list a folder, recent notes, tags, daily and other periodic notes, boards and tasks, and propose changes. Recto must be open; when it is not, the client gets a clear "Open Recto" message.
- AI clients never write straight into your notes by default: their changes arrive as Suggested edits, each with a diff and Apply or Discard. A count shows in the status bar, and a notification appears when Recto is not in front. A proposal made against an older version of a note writes nothing.
- Settings → AI → Write mode: Read only (the AI sees the vault and writes nothing), Propose (the default) or Write directly, which backs up every changed file in `.recto/backup/ai/` first.
- Recto's rules apply to what the AI writes: note names stay unique, links must resolve and use the vault's link form, periodic notes are made from their template in the folder Settings point to, boards change only through the board tools, and excluded folders and notes are never returned or changed.
- Formatting profile with 8 rules for notes the AI writes. "Detect from my notes" imports Obsidian Linter's matching settings when the plugin is on, then fills the other rules from what at least 80% of your notes do (mixed habits stay "Leave as written"), with a before/after preview. The rules apply only to the lines the AI writes, never to the rest of a note.
- AI guide: choose any note as the guide AI clients read first, or let Recto draft one from a template for you to edit. A vault profile (folders, templates, periodic notes, link style, properties, tags, boards, topics when on, the formatting rules) is available to the client too.
- Activity log of what AI clients did (tool, note paths, outcome), without any note text.
- Connect a client with one click in Settings → AI: Recto shows the exact lines it will add, copies the client's file to a backup first and leaves every other entry untouched. Each client shows its status and a "Test connection" button. Claude Desktop is connected with a `.mcpb` extension built on demand, or through its config file.
- The command AI clients run is refreshed on every start, so updating or moving Recto does not break a connected client.

## v0.53.1 — 2026-10-31
### Added
- Recto keeps the notes its features make in one `Recto/` folder: boards in `Recto/Boards/<Board>/` with their cards beside them, cards on no board in `Recto/Unsorted/`, chats in `Recto/Chats/`, and a `Recto/README.md` saying what the folder is. They are ordinary Markdown notes: indexed, searchable, linkable by name and synced. Chats and `Recto/README.md` stay out of the overview's counts and lists and out of the graph (chats can be shown in it).
- On first open, an existing vault's `tasks/` and `chats/` are moved into that layout once, with a copy of everything it touches in `.recto/backup/layout-<date>/`, a notice afterwards saying what moved, and nothing written if a target is already taken. History follows each moved note. Links keep working as they are; only a link that would otherwise point at another note or at a path that no longer exists (such as `[[tasks/X]]` when another X exists) is rewritten, to the shortest path that names the note alone (`[[Launch/Choose a name]]`, not the full path); Markdown-style links get the full vault path.
- Deleting a board asks where its cards go: Unsorted, another board (lines merged, never twice), or the macOS Trash. The board note itself goes to the Trash too (not the archive). A card another board still lists is never trashed. Every delete has an Undo that puts back the board, the trashed cards, the moved cards and the lines added to the other board, as long as they have not changed since.
- New boards set Obsidian Kanban's `new-note-folder` to their own folder (nothing else in the settings block changes), and new cards are made there.
- Settings → Vault → "Show the Recto folder" shows the folder in the Data tree.
### Changed
- Renaming a board renames its folder and file, moves its cards one by one (history and links follow) and updates `new-note-folder`.
- After you take a card off a board, delete a board or add an existing note to one, a card file in `Recto/Boards` or `Recto/Unsorted` is filed again: on no board it goes to Unsorted, on exactly one board to that board's folder, on several it stays. Notes outside `Recto/` that sit on a board are never moved or trashed.
- The Data tree hides `Recto/` with one rule, replacing the separate rules for `tasks/` and `chats/`.
### Fixed
- A name is never changed silently. A name with "/" (or another character a file name cannot hold: \ : * ? " < > |, or a leading ".") is refused with "“/” can't be used in a name" for new notes, tree renames, cards, boards and their renames; cards and boards also refuse # ^ [ ] | because they break links. Before, "Basil/Soil" became "Basil Soil". The [[ "Create" row is not offered for such a name.
- A tab showing a note made a moment ago (a new board opened at once, say) was closed again because the file tree had not caught up. Tabs are now closed only after the disk confirms the file is gone.
- Creating a board or card with a name that was already taken gave one of two different messages, and the first check could be stale. There is now one check, against the files on disk. The "+" popover says "A note “X” already exists in <folder>. Add it to this board?" and offers "Add it to this board" (adds `[[X]]` in the shortest form that names it, the file is not moved or copied) or "Choose another name"; a new board with a taken name says the same, with "Open that board" when that note is a board.

## v0.53.0 — 2026-10-30
### Added
- Each tab keeps its own history - the note, where it was scrolled and where the caret was - up to 100 steps, kept when Recto restarts. ← and → at the top left of a note, board, file or the overview say how many steps they hold; ⌘ over one names where it goes. Right-click (or a long press) lists the steps, and picking one jumps there; ⌘ on a click opens that step in a new tab. ⌘[ and ⌘] and the mouse's back and forward buttons do the same. Renamed notes are followed and deleted ones skipped.
- A card opened on a board is a step in the tab's history (← closes it again), and so is each list opened in the overview.
- "Open overview in a tab" in the command palette: the overview as a tab, whose lists and the notes opened from them are steps in its history. A note opened from the ⌃⌘H overlay has the overview as its step back.
- Pin a tab from its right-click menu: it becomes a narrow icon at the left of the row, stays there, and survives "Close others" and "Close to the right". Pins are kept when Recto restarts.
- A tab's right-click menu: Close, Close others, Close to the right, Pin or Unpin, Copy link (`[[Note name]]`) and Reveal in tree, which opens the sidebar on the Data tree with the note's folders expanded. "Reveal in tree" is also in the command palette.
- When the tabs no longer fit, the row scrolls sideways (with a mouse wheel too) and an "All tabs" button at the right lists every tab in the pane, with a search field.
- Drag a tab along the row to reorder it; a line shows where it will go.
- Hold ⌘ over a tab to see the note's path. Two open tabs with the same name show their folder in smaller text beside the name.
- Tooltips and hover info (button names, shortcuts, Tidy's explanation) show only while ⌘ is held, everywhere in the app, so moving the pointer around shows nothing. Reaching a button with the keyboard still shows its tooltip.
- A board's right-click menu has "Copy relative path" and "Copy full path".
- A note with no properties has a faint "+ Add property" above its first line, shown when the pointer is over it; "Add properties to note" in the command palette does the same.
### Changed
- A note, board or card opens in the tab you are in, so ← takes you back; ⌘-click opens it in a new tab. A pinned tab is never replaced - what you open from it gets a tab of its own - and neither is a chat or the graph. A board reached from a note opens in that same tab.
- Properties are inside the note, at the top of the text where the frontmatter is: one line, `› status active · due 2026-11-03`, that opens into the editable table in place. They scroll with the note, and a note without properties shows nothing. The file is unchanged: still plain YAML frontmatter. In Source mode the YAML shows as before.
- The note's path is no longer shown at the top left of a note, code file or image; hold ⌘ over its tab instead.
- The formatting toolbar floats over the top of the note as a glass bar while you are editing it, and fades out when you are not, instead of taking a row of its own.
- Tabs: the tab open in a pane is a card of the page's own colour joined to the page, on a clearly darker bar, so which tab is open is plain to see in both themes; the others are quiet text. A short dark bar under the name marks the note you are in. Tabs shrink to 120px before the row scrolls.
- Neutral colours in both themes: the light theme's beige chrome (tab bar, toolbars, borders, grey text) is plain grey on white, and the last tints are gone from the glass, the sidebar and the tab marking in both themes.
### Fixed
- A tooltip with a long explanation (Tidy's) no longer runs out past the edge of its bubble over whatever is behind it.

## v0.52.2 — 2026-10-29
### Fixed
- A note that can't be saved (disk full, no permission) keeps your text in the editor, says why next to "Unsaved", and tries again on the next keystroke, ⌘S or closing the tab; before, the editor was replaced by an error and the unsaved text was lost. Renaming such a note is refused instead of moving the old file.
- Notes and files with Windows line endings (CRLF) stay that way: opening and closing one, editing a property or a card field, the boards migration and a rename's link updates no longer rewrite every line to LF.
- A file whose invalid UTF-8 starts after its first 8 KB is no longer opened and saved back with those characters lost; it's refused like any other non-UTF-8 file.
- Two saves to the same note at once (an autosave and a board or card edit) no longer collide on one temporary file.
- A rename's link updates are written safely, like any save, and undoing the rename leaves alone a note you edited since, instead of putting its old text back over your changes.
- Renaming or deleting a topic while topics were running no longer gets undone when the run ends, which could also strip the renamed topic from every note.
- A bot's answer that can't be written to its topic ends with an error instead of "done" with nothing saved, and a question that can't be written is refused.
- Naming or renaming a chat topic no longer writes an older copy over a question just sent, and waits while an answer is being written.
- A board change after one that failed no longer brings the failed change back or writes over an edit made in Obsidian meanwhile; edits to one card's note made close together (notes and a field, or a move into Done) no longer drop one another.
- The boards migration runs once per vault: a note with a `board:` key of its own no longer loses its `board`, `status` and `order` keys on every open, and opening a vault no longer reads every note to check.
- Pressing Enter with Cancel focused in a delete confirmation cancels; before, it deleted.
- Pressing Escape while renaming a note from its title, or in a folder field in Settings, puts the old name back instead of renaming to what was typed.
- Closing a tab to the left of the one you're on keeps showing that tab; before, the pane jumped to its neighbour while ⌘W and the breadcrumb still acted on the hidden one.
- "Close other tabs" closes only the tabs in that pane, not every pane's.
- Closing a vault right after typing no longer loses the last keystrokes.
- Renaming a note or folder when only the case changes (`ideas` to `Ideas`) works; before, it said the name already existed.
- Pasting a sentence with a comma ("Oslo, Norway") into a table cell pastes it into that cell, instead of splitting it across the next cell too.
- Backlinks show the line the link is on in notes with frontmatter; before, they showed a line further down or nothing.
- Sentence focus no longer stops working at the start of an indented line.
- A local bot model that keeps asking for tools after its last allowed call no longer keeps the answer running until stopped.
- Purging from the archive only ever trashes items the archive holds.
- Tidy no longer files notes into the tasks, templates or other reserved folders by making a new folder of the same name; a move that fails is listed in the dialog instead of the dialog closing as if it all went, and an error no longer leaves it stuck.
- Deleting a column moves every card out, lines of text included, in their order; before, some text cards were skipped and the column couldn't be deleted.
- Dragging a card from a board onto the file tree no longer moves its note out of tasks/.
- Writing the word "constructor" no longer breaks the words-written count.
- Switching Live Preview off shows hidden frontmatter, code fences, tables and maths at once, not after the caret moves; a sentence that starts with three backticks is no longer hidden as a code fence.
- The graph no longer restarts its layout every time you open another note (unless it shows only the open note's neighbours).
- Topics no longer search the whole vault for new topics on every run when nothing changed since the last search, and asking a bot what to change in a large vault no longer freezes the app comparing every note title with every other.

## v0.52.1 — 2026-10-19
### Changed
- "Words written" is the words you added and kept, not the change in the vault's total: each save in the editor or a card's panel counts the words it brought in, and a word you typed and deleted again comes off. Deleting text that was there before that day takes nothing off, so it never goes below zero; moving text changes nothing; Recto's own writes (migrations, link updates on rename, `completed` stamps, board moves) and other apps' changes never count. It shows the week's words with today's beside them.
- The days before this were read in once from version history, on the days you edited each note, so this week isn't blank.
- Board notes add no words to the vault's total: their lines are links to cards. A day counted under the old rule starts again under the new one instead of showing the difference.
- A board's preview shows its columns with their card counts and how many cards are done, instead of its frontmatter and headings.
### Fixed
- The overview opened while the vault was first being read showed zero notes until it was opened again; it now fills in by itself.
- The overview showed "−1,338 words written" after notes were archived: a drop in the vault's total was taken for words you wrote.
- A note's preview no longer turns up after you've moved on. Clicking a link before the preview delay is over, a hotkey that changes the view, opening the overview, settings or the palette, a scroll, or the link or tree row disappearing now stops it or puts it away at once; before, it could appear a few seconds later over the board or note you'd gone to, or stay where it was. One preview, with the same rules, for links in notes, floating notes and the file tree.

## v0.52.0 — 2026-10-18
### Added
- A board is a note in the Obsidian Kanban format: the same board opens in Recto and in Obsidian with the Kanban plugin. Its columns are the note's headings and its cards the lines under them, in order; a card is either a link to a note in tasks/ or a line of plain text.
- Moving a card rewrites only its own line in the board note, nothing else in it: lines Recto doesn't understand and the plugin's settings block stay as they are. Into the done column the line is ticked and the card's note gets `completed`; out of it both are undone. If the board changed meanwhile (Obsidian, sync), the same move is made to what is there now.
- "Make it a note" in a plain-text card's panel: the note is made in tasks/ (its first line the name, the rest the body) and the line becomes a link to it.
- "Markdown" on a board shows the note itself, with a word that Obsidian removes text outside the columns when it saves the board.
- Links to a board show a board icon, and links to a card show where it stands: an open circle in its first column, half filled in any column between, a check when done, a dashed circle when its boards disagree. Inside the link in the editor and in the [[ list, updated when the card moves.
- The graph has Boards (on) and Tasks (off): a board is a rounded square, a card a small dot in its status colour, tied to its board by a thin dashed line. Hovering a card shows its column and due date; clicking it opens it beside its board.
- "Cards here are done" in a column's menu marks the done column, as the plugin's "Mark cards in this list as complete" does.
- Deleting a board asks whether to keep its card notes (the default) or archive them too.
- A card's panel edits the note's text in place, under its fields: the same editor as a note's tab, so Markdown shows as it is typed, a `- [ ]` is a box to tick and [[ offers the vault's notes. Comments sit below it.
### Changed
- A [[link]] to a card opens it beside its board in Tasks, not as Markdown in Data. The card panel's separate description and checklist are part of the editable text now.
- Boards live in tasks/ beside their cards, and are made, renamed, deleted and opened from the Tasks list; the Data tree shows neither boards nor cards, wherever they are. A [[link]] to a board opens it in Tasks.
- Card notes no longer carry `board`, `status` or `order`; the board note says where each card is. A note can be on several boards; its panel shows its column on the board you're looking at.
- A column's WIP limit is written in its heading, `Doing (3)`, as the plugin writes it; its colour and dates, the board's widgets and sort sit in the note's settings block under `recto`.
- On first open, the boards of `.recto/boards.json` become board notes in tasks/, with the cards in their order, Done ticked, and the plugin set to show each card's priority and due date. Cards whose status named no column go to an "Unknown status" column at the end. Every file it changes is copied to `.recto/backup/<date>/` first, and a notice says what changed and where the copy is; a board whose name a note already has asks for another name before anything is written. Running it again changes nothing.
- Notes are read again once after updating, to find the boards.
### Removed
- `.recto/boards.json`: after the move it is only in the backup.

## v0.51.0 — 2026-10-18
### Added
- The vault overview's figures (⌃⌘H, then →) are a page that scrolls as a whole, wherever the pointer is: the vault's name large on the moving field, then a solid card with every figure, white in the light theme and the page's dark in the dark one. No figure sits on the field any more, so nothing is lost on a light patch. Back and the shortcut stay in the top corners.
- ⌃⌘H reopens on the pane, page and scroll you left it on, after a restart too. Pressed again it goes back to the note or board you were on, at the same scroll.
- New figures: words in the vault, words written this week (counted from now on, each day's change in the total), the writing streak and the longest one, and time in Recto (an average per day this week, last week's, this month and in all; counted only while the window has focus and you were active in the last 2 minutes).
- "Notes touched" and "words written" show today's change beside the number ("+4 today", "−120 today"). Nothing changed today, nothing shown. Fewer words is shown in grey, not red.
- Writing activity: the last 26 weeks across the card, one square a day shaded by the notes you edited. Hover shows the date and the count; a click lists that day's notes.
- Needs attention: notes with no links either way, broken links and overdue cards, each opening a list.
- Topics (when Topics is on) and Rediscover: a note written a month or a year ago today, and the most linked note you haven't opened for 60 days.
- One line under the card's heading says since when the figures are counted ("Stats counted from today"); no figure shows a dash.
- When no note has the name you typed after [[, the list's last row is "Create “name”": it writes the link and makes the note.
### Changed
- "Notes touched" and the streak count only edits you made (editor saves, card edits and moves), not Recto's own writes or changes from other apps or sync. The last month of version history is read in once, so the first weeks are not blank.
- Sections with nothing in them are not shown; with only one of Most written in and Most linked, it takes the card's width. A week's line appears once it has three days to draw, and one note then two is a gentle rise rather than a spike.
- The [[ link list is a glass layer like the find bar, in both themes: the app's font, no type icon, the note's name with its folder after it (a long folder is shortened in the middle), at most eight rows before it scrolls, and a soft accent on the chosen row instead of solid blue. The == highlight list looks the same.
- Notes are read again once after updating, to count their words.
### Fixed
- Settings blurs what is behind it everywhere, also where it lies over the sidebar: there the sidebar's names showed through almost sharp. The panel is the page's colour at 70% with a 24 px blur, its cards at 85%. Translucency off still gives a solid panel.

## v0.50.1 — 2026-10-16
### Fixed
- A file name is unique in the whole vault again, ignoring case: a second note called "Plan" in any folder is refused, and so is a second Plan.pdf. A note and a file may share a base name (Plan.md and Plan.pdf). This holds for new notes and files, New file…, renames (including changing the type), moves between folders, new cards and periodic notes. The error names the file that already has the name, and New file… stays open to show it.
- "Untitled", the sidebar's "New task" and dropped or pasted files get a number that is free in the whole vault, not just in their folder.
- Rename opened with a double-click on a note in the tree now keeps the cursor in the name field; the note that opened behind it took the focus, so typing went into the note.

## v0.50.0 — 2026-10-16
### Added
- New widgets: Today (cards today falls inside, or due today), By priority (open cards per priority; click a row to filter the board, again to clear), Overdue (late cards, the oldest first) and Recently done (the last five cards to enter Done). "+ Widget" lists every widget, ticked when shown, so it always has something to offer.
- Drag a widget by its header to move it in the strip.
- The calendar shows a week, two weeks or a month. Arrows step a whole view, a sideways scroll or a drag on the grid moves a day at a time, and Today comes back. A bar that runs past the visible days ends in an arrow with its end date ("→ 25 Oct"), and hovering any bar shows its full range.
- "New card" in the command palette opens the new-card field with the column to choose.
### Changed
- Cards are added one way: "+" in a column's header opens a title field over the column. Enter adds the card and closes it, ⌘Enter adds it and stays open for the next one, Esc or a click outside closes it. A name that is already a note is shown under the field and nothing is made. The "New card" field at the bottom of each column is gone.
- Every change on the board shows at once and is written to the note after: new cards, status, priority, dates, tag, checklist ticks and renames. If the write fails, the change is undone and a notice says so.
- A card's title is its file name, like every note in Recto. New cards are made without an H1. Renaming the title in the card panel renames the note, and links follow. Older cards keep their H1; one that repeats the name is not shown as the description.
- Headings in the editor use the heading font, sans by default, like the note's name above them. They used to follow the editor's mono font. A heading font you picked in Settings → Editor is kept.
- The board's background is the plain page in both themes, with no colour wash. Widgets sit on it without a floating shadow.
- The filter field, High only, Widgets and Sort share one height, radius and border; a tool that is on is tinted with the accent.
- Due soon lists today and the next three days; late cards are under Overdue.
- A column's date range reads like the cards' ("16–22 Sep"), and a column with a WIP limit shows its count once, in the limit.
- Empty columns say that "+" adds a card.
- Settings is frosted glass in both themes: what is behind it is blurred (24 px) and saturated under a tinted fill.
- Switches are a size smaller, with the knob 2 px inside the track as on macOS, everywhere in the app. An off switch's track is easier to see in the dark theme.
### Fixed
- Pressing Enter twice while a card was being made could make it twice.
- A selected card's outline is drawn inside the card, so the column's scrolling no longer clips its left edge or date.
- The calendar's today line runs under the bars instead of across their text.
- The Settings panel's bottom-right corner can be grabbed right up to its edge to resize it.

## v0.49.0 — 2026-10-16
### Added
- Task cards show a priority label (High, Medium, Low, No priority), their date or date range (red when late, amber when due within two days), two lines of description, checklist progress, the link count and a tag. All of it is plain frontmatter and text in the card's note: `priority`, `start`, `due`, `tags`.
- Clicking a card opens it in a panel beside the board. Status, priority, dates and tag can be edited there, checklist items ticked, and "Open as note" opens the note. A start date after the due date is not saved. Esc or ✕ closes the panel.
- Each column's menu holds rename, colour, a WIP limit (the count turns amber when reached) and a date range. "+" in the header jumps to the column's "New card" field.
- Widgets above the board: a week calendar (cards and column date ranges as bars, a line on today, click a bar to open the card), Done this week (cards per day) and Due soon (late and the next three days). Add and remove them with "+ Widget" and ✕, or hide the strip with the Widgets button. Each board remembers its choice.
- A card moved into the Done column gets `completed: <date>`, which is removed when it moves out. Done this week counts these dates, so it starts counting from this version.
- Toolbar: filter cards by text, show High only, sort by priority, due date or title.
### Changed
- Columns are glass panels that run the full height of the board, with their cards scrolling inside, over a soft wash instead of a flat background.
- "Add column" is a slim strip at the end of the row that no longer looks like it runs off the window. A new column gets a unique name and opens for renaming.
- "New card" is always at the bottom of each column. Enter creates the card and keeps the cursor there for the next one.
- Dragging a card fades it and shows a line where it will land; the target column is highlighted.
- A card whose status names no column now shows in an "Unknown status" column at the end, instead of passing for a card in the first column.
- Deleting a column that has cards asks which column they move to. Their notes are never deleted.
- Editing a card from the board changes only the key being edited, keeps key order and comments, and keeps `tags` in the form it was written (`tags: ui`, `[ui]` or a list). Dates are written as `YYYY-MM-DD`; a date with a time is shown as its date and left as it is unless you edit it.

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
