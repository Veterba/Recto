# Obsidian's rules for note names and links

Recto follows Obsidian exactly, so a link means the same file in both apps. This file is the spec; every rule
here has a test (`test/shared/obsidian-links.test.ts`), generated from what Obsidian itself answered; the
code is `src/shared/obsidian-links.ts`.

Sources, marked on each rule:
- **[measured]**: Obsidian 1.15.0 on a test vault (`~/Recto-test-vaults/obsidian-links/`, 2026-11-04): links
  clicked by hand (the table in `Obsidian link test.md`), and Obsidian's own functions called in that vault
  (`getFirstLinkpathDest`, `getLinkpathDest`, `generateMarkdownLink`, `renameFile`, `vault.create`).
- **[docs]**: obsidian.md/help (links, Files and links settings).
- **[api]**: `obsidian.d.ts` doc comments.

## 1. Reading a link

A link is a wikilink `[[target]]`, `[[target|alias]]`, `![[target]]`, or a Markdown link `[text](target)`.

1. The subpath goes first: `#Heading`, `#Heading#Sub`, `#^block` are cut off; the rest is the *linkpath*.
   In a Markdown link the target is URL-decoded first (`%20` is a space). [docs] [measured]
2. `/x` is a path from the vault's top. [measured: `[[/Plan]]` → `Plan.md` from every folder]
3. `./x` and `../x` are relative to the linking note's folder; `..` above the top stays at the top. The file
   there, or nothing: no other file is tried. [measured: `[[./Plan]]` → the source folder's `Plan.md`, from `C/`
   (no `C/Plan.md`) unresolved; `[Plan](../A/Plan.md)` → `A/Plan.md` from `A/`, `B/`, `C/` and the root, unresolved
   from `A/sub/`]
4. Otherwise, an **exact vault path** wins: the linkpath, or the linkpath + `.md`, equal to a file's path,
   ignoring case. [measured: `[[Plan]]`, `[[plan]]`, `[[Plan.md]]` → `Plan.md` from every folder, also from
   `A/sub/` which has its own `Plan.md`; `[[a/plan]]` → `A/Plan.md`]
5. Otherwise, every file whose path **ends with** `/` + linkpath (or + `.md`), ignoring case, is a candidate,
   ranked: [measured, `getLinkpathDest`]
   1. files in the linking note's folder or any folder under it, before all others
      (`[[Idea]]` from `A/` → `A/sub/Idea.md`, from `C/` → `C/deep/Idea.md`; `[[Sub]]` from `C/` →
      `C/zz/Sub.md` over a shorter `Q/Sub.md` made earlier);
   2. then the shorter path, in characters (`X/Y/L4.md` over `AAAAAAAA/L4.md`; `B/Len3.md` over
      `AAAAAAAA/Len3.md` made earlier);
   3. then Obsidian's file order: the order files were made in this session (a later edit does not change
      it); after a restart, the order Obsidian scanned the vault in, which an app outside Obsidian cannot know.
      Recto uses the files' creation time, then the path - the same answer whenever the files were made in
      order, and only ever different between two files equally near and equally long.
   The first is the link's file. [api: `getFirstLinkpathDest` "best match"]
6. No file: the link is unresolved. Clicking it creates the note in the vault's top folder (with default
   settings). [measured: `[[Missing]]` → `Missing.md` in the root]
7. A file that is not a note needs its extension: `[[Image.png]]`, `![[Image.png]]`. Same rules otherwise
   (`![[Image.png]]` from `A/` → `A/Image.png`, from the root → `B/Image.png`). [docs] [measured]

## 2. Writing a link

Obsidian writes a link with `generateMarkdownLink(file, sourcePath, subpath?, alias?)`, by two settings in
`.obsidian/app.json`: `newLinkFormat` (`shortest` default, `relative`, `absolute`) and `useMarkdownLinks`
(default `false`: wikilinks). [docs] [measured]

| Format | Wikilink | Markdown link |
|---|---|---|
| shortest, the name is the only one in the vault | `[[Source B]]` | `[Source B](Source%20B.md)` |
| shortest, more than one file has the name | the full vault path: `[[A/sub/Plan]]` (also from `A/sub/` itself); a note in the top folder: `[[Plan]]` | `[Plan](A/sub/Plan.md)` |
| relative | from the linking note's folder: `[[../A/Plan]]`, same folder `[[Plan]]`, below `[[deep/Idea]]` | `[Plan](../A/Plan.md)` |
| absolute | always the full vault path: `[[B/Source B]]`, `[[Plan]]` for the top folder | `[Source B](B/Source%20B.md)` |

- Notes are written without `.md` in wikilinks, with `.md` in Markdown links; other files keep their extension
  (`[[A/Image.png]]`, `[](A/Image.png)`). [measured]
- A subpath goes after the path (`[[A/sub/Plan#Heading|alias]]`, `[alias](A/sub/Plan.md#Heading)`); an alias
  is a wikilink's `|alias` and a Markdown link's text (the file's name when there is none). [measured]
- Markdown link targets are URL-encoded: a space is `%20`. [docs] [measured]

## 3. Renaming and moving

With "Automatically update internal links" on (`alwaysUpdateLinks`), every link that resolves to the renamed
or moved file is written again in the current format (§2), keeping its alias, subpath and `!`; a Markdown link
keeps its text. Links to other files, and links that did not resolve, are not touched. [measured]
- `B/Plan.md` → `B/Plan 2.md` (now a unique name): `[[B/Plan|alias B]]` → `[[Plan 2|alias B]]`,
  `[[B/Plan#Heading]]` → `[[Plan 2#Heading]]`, `![[B/Plan]]` → `![[Plan 2]]`, `[B plan](B/Plan.md)` →
  `[B plan](Plan%202.md)`, `[[./Plan]]` in `B/` → `[[Plan 2]]`.
- `A/Plan.md` → `C/deep/Plan.md` (name still shared): `[[A/Plan]]`, `[[a/plan]]`, `[[A/Plan.md]]`,
  `[[./Plan]]` in `A/` → `[[C/deep/Plan]]`; `[Plan](../A/Plan.md)` → `[Plan](C/deep/Plan.md)`;
  the same link from `A/sub/`, which did not resolve, stays.
With the setting off, Obsidian asks on every rename (a dialog "Update links": "Do you want to update internal
links that link to this file? This will affect N links in M files.") with three answers: **Always update**
(turns the setting on, then updates), **Just once** (updates this time), **Do not update**. [measured]
The setting is `alwaysUpdateLinks` in `.obsidian/app.json`; Obsidian's default is off.

## 4. A new file with a name already used

No link is rewritten. A link may now resolve to the new file: a new `Idea.md` in the top folder took
`[[Idea]]` from every folder (an exact vault path, §1.4). [measured]

## 5. Names

- Refused: `\`, `/`, `:` ("File name cannot contain any of the following characters: \ / :"). Everything
  else is allowed, including `* " < > | ? # ^ [ ]` (links to names with `[ ] # ^ |` cannot work).
  [measured: `vault.create`]
- Case: two names that differ only in case are the same file: `plan.md` beside `Plan.md` is refused
  ("File already exists."). [measured]
- Several files may have the same name in different folders. [measured]

## 6. What Recto adds

Not Obsidian's rules, but how Recto applies them. None of this changes what a link means.

- **Warnings, not refusals.** A name with `# ^ [ ]` or `|` gets Obsidian's own warning ("Links will not work
  with file names containing any of these characters: # ^ [ ] |") under the name field, before anything is
  made. So does a name Windows cannot hold (`* " < > ? |`, or a dot or space at the end) and a name starting
  with `.`. The name is never changed.
- **A moved note's own links.** When a note moves, a link of its own that would now mean another file (a
  relative or partial path) is written again for the file it meant. Not measured in Obsidian: Recto does it so
  that no link breaks.
- **Links that depend on file dates.** When only the last tie-break (§1.5) picks the file, the overview lists
  the link under "Links that depend on file dates". Creation times change on a copy, a git clone or some syncs,
  so another Mac can open the other file, in Obsidian too.
- **Every file is known.** The index keeps every file in the vault, not only notes, so `[[Image.png]]` and
  `![[a.pdf]]` resolve as they do in Obsidian.
- **A tie Obsidian leaves to its index order.** Recto uses the file's creation time, then the path (§1.5).
- **AI tools.** A note given to a tool by a name several notes have is not guessed: the tool lists them. A new
  bare `[[Name]]` that several notes have is refused, with the exact links to write instead.
- **Settings.** Recto reads `.obsidian/app.json` and writes it only for "Always update" (§3), as Obsidian does.
  For a vault Obsidian has never opened (no `.obsidian/`), Recto keeps the same keys in
  `.recto/link-settings.json` rather than making an `.obsidian/` folder.
