# Bugs found during the refactor

Logged, not fixed (the refactor is behaviour-preserving). Each: file, line, repro.

1. **Renaming a note without typing `.md` turns it into a non-note.** The rename field starts as
   `Tomatoes.md`; replace it with `Tomato plants` and the file becomes `Garden/Tomato plants` (no
   extension) while the links in other notes are rewritten to `[[Tomato plants]]`, which now
   resolve to nothing. `features/file-tree/components/FileTree.tsx:122` (`commitRename`) passes the
   name through as typed. The fix exists, unmerged, in the stash "rename keeps .md".
2. **The command palette and the quick switcher sometimes reopen with the previous query.** Repro,
   not every time: ⌘O, type `Basil`, Enter; ⌘O again - the field still says `Basil`, and typing
   appends (`BasilSoil`, "No matching note"). The same with ⌘P after running "Open graph as a tab"
   and pressing ⌘G. The query is cleared by an effect when `open` changes
   (`ui/picker.ts:24`); in the runs where it stays, that effect did not clear it. Timing-dependent:
   seen on both v0.34.11 (before phase 4 moved this code into `ui/picker.ts`) and now, at different
   steps of the same script.
3. **"New task" in the Tasks sidebar makes the card but does not open it.** Tasks → a board → the
   sidebar's Task button: `tasks/New task.md` is created and appears on the board, but no editor
   opens, though the code means to (`app/hooks/use-shell-create.ts:79`, "opens it, so you can start
   typing"). Same on v0.34.11.

Found by the phase 5 checklist run (`snapshots/checklist.mjs`, local).

## Regressions the refactor itself introduced (fixed)

These broke "behaviour-preserving", so they were put back rather than logged and left.

1. **Phase 3 - a failed API-key test showed in grey, not red.** `.setting__note--bad` was split into
   `features/ai/styles/chat.css`, which loads before `features/settings/styles/settings.css`; with
   `.setting__note` after it and at the same specificity, its `color` lost. In the old `app.css` it came
   after (line 4251 against 2415). Repro before the fix: Settings → AI, save a wrong key, Test - the
   message was muted grey. Fixed in phase 5 by moving the rule to `settings.css`, after its base.
   Missed in phase 3 because the two classes only ever meet in a template string, and no snapshot
   screen shows a failed test.
2. **Phase 3 - a tree row under the pointer during a drag could show hover instead of the drop
   target.** `.tree__row.is-drop` and the drop lines were split into
   `features/editor/styles/markdown-view.css`, which loads before `file-tree.css`, so
   `.tree__row:hover` (same specificity, same `background`) came after it; in `app.css` the drop rule
   came after hover (1478 against 1328). Fixed in phase 5 by moving the drop rules back into
   `file-tree.css` at their old place.

Found by comparing the order of every rule pair in the old `app.css` against the built CSS, for
selectors of equal specificity that set the same property and whose classes can be on one element
(from every `className` in the code, template strings included). After the fixes, no such pair is
left.
