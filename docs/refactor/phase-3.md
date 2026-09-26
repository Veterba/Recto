# Refactor phase 3 — CSS

`app.css` (7,819 lines) is gone. The stylesheets are now 43 files, none over 400 lines (largest:
`ui/styles/color-editor.css`, 386), 8,003 lines in all (8,261 before, with `tokens.css`).

## Where the CSS lives

- `styles/` - `tokens.css` (custom properties only), `base.css` (element rules, buttons),
  `layout.css` (the shell, splits, floating windows), `motion.css`.
- `app/styles/` - the shell's own parts: sidebar, sidebar parts, tabs and status bar, palette,
  first run, the sidebar's colour.
- `ui/styles/` - the primitives: toggle, tooltip, menu, dialog, colour editor, pill slider, sliders.
- `features/<feature>/styles/` - each feature's own, imported from its `index.ts`.

Global stylesheets are imported once, in `app/main.tsx`, before `App` and in the order `app.css` had
them. Two are imported after `App`: `motion.css` and `app/styles/sidebar-colour.css`.

## Keeping the cascade

Sections moved whole, and inside each file they keep their old relative order. Merging a feature's
scattered sections into one file still reorders rules, so every rule pair whose order flipped was
checked: can the two set the same property, at the same specificity and importance, on the same
element? "Same element" was decided from the code: which classes are ever given together, in any
`className`, `class:`, `classList` or `.className` expression. Three real conflicts came out, all fixed:

1. `motion` redefines `transition`/`animation` for components everywhere; placed early, the
   components' own rules would have won. Now imported after every feature.
2. "The sidebar's colour" re-colours `.status` and the shell; same fix.
3. `.toggle` (in the settings section) against `.toggle--sm` (note properties) on the same element;
   `.toggle` is a shared primitive and moved to `ui/styles/toggle.css`, loaded before both.

58 remaining flipped pairs were checked by hand and cannot meet: a dynamic class prefix matching an
unrelated name (`tab${…}` vs `tab__close`), `svg`/`i`/`span` inside components never nested in each
other, `.gset > *` against things never direct children of the graph settings panel.

Then independently: every element's computed style (and `::before`/`::after`) on all 36 snapshot
screens, before and after, with a new `npm run snapshots -- --styles`: identical, apart from
CodeMirror's own measured geometry (which lines exist, where its cursor and indent-guide layers sit),
which varies between runs of the same build too.

## Dead CSS removed

A rule is removed when a class in its selector appears nowhere in the source as text and matches no
class built at runtime (`` `cm-fold-toggle--h${level}` ``, `'is-' + …`); CodeMirror's `cm-*`,
KaTeX's and lucide's classes were never candidates. Cross-checked with Chrome's CSS coverage over all
36 screens: none of these rules was used (the one apparent hit, `.titlebar-btn:hover`, is also the text
of one selector inside a seven-selector rule that other selectors match). 31 rules, and 2 selectors
out of selector lists:

| file | what | removed |
|---|---|---|
| `app/styles/sidebar-parts.css` | rule | `.sidebar__new` |
| `app/styles/sidebar-parts.css` | rule | `.sidebar__new span` |
| `app/styles/sidebar-parts.css` | rule | `.sidebar__new:hover` |
| `app/styles/sidebar-parts.css` | rule | `.sidebar__head` |
| `app/styles/sidebar-parts.css` | rule | `.sidebar__actions` |
| `app/styles/sidebar-parts.css` | rule | `.icon-btn--sm` |
| `app/styles/sidebar.css` | selector | `:root:not([data-translucent='off']) .shell__titlebar .titlebar-btn:hover` |
| `features/editor/styles/markdown-view.css` | rule | `.md__area` |
| `features/editor/styles/markdown-view.css` | rule | `.md__area::placeholder` |
| `features/editor/styles/markdown-view.css` | rule | `.md__note` |
| `features/graph/styles/graph-settings.css` | rule | `.gset__stack` |
| `features/graph/styles/graph-settings.css` | rule | `.gset__seg` |
| `features/graph/styles/graph-settings.css` | rule | `.gset__seg > button` |
| `features/graph/styles/graph-settings.css` | rule | `.gset__seg > button:hover` |
| `features/graph/styles/graph-settings.css` | rule | `.gset__seg > button.is-on` |
| `features/graph/styles/graph-settings.css` | rule | `.gset__seg--icons > button` |
| `features/graph/styles/graph-settings.css` | selector | `.gset__seg > button:focus-visible` |
| `features/graph/styles/graph.css` | rule | `.graph__sep` |
| `features/topics/styles/topics.css` | rule | `.autolinks__count` |
| `features/topics/styles/topics.css` | rule | `.suggested__label` |
| `features/topics/styles/topics.css` | rule | `.suggested__chips` |
| `features/topics/styles/topics.css` | rule | `.suggested__chip` |
| `features/topics/styles/topics.css` | rule | `.suggested__chip:hover` |
| `features/topics/styles/topics.css` | rule | `.suggested__add` |
| `features/topics/styles/topics.css` | rule | `.suggested__chip:hover .suggested__add` |
| `features/topics/styles/topics.css` | rule | `.suggested__reject` |
| `features/topics/styles/topics.css` | rule | `.suggested__reject:hover` |
| `styles/layout.css` | rule | `.shell__vault` |
| `styles/layout.css` | rule | `.shell__titlebar-actions` |
| `styles/layout.css` | rule | `.titlebar-btn` |
| `styles/layout.css` | rule | `.titlebar-btn:hover` |
| `styles/layout.css` | rule | `.titlebar-btn.is-on` |
| `styles/layout.css` | rule | `.titlebar-btn:focus-visible` |

What they were: the retired auto-links chips (`suggested__*`), an old title bar (`titlebar-btn`,
`shell__titlebar-actions`, `shell__vault`), the pre-CodeMirror textarea (`md__area`, `md__note`),
an unused segmented control in graph settings (`gset__seg*`), and old sidebar pieces.

## Tokens

Only where the value is the same everywhere:

- Spacing - `margin`, `padding`, `gap` of 4/8/12/16/24/32px → `--size-1/2/3/4/6/8`: 88.
- Radius - 6/10/16px → `--radius-s/m/l`: 5.
- Font size - a new scale in `tokens.css`, one token per size used three times or more
  (`--font-size-9-5` … `--font-size-20`, 12 sizes, named by value): 171 whole-value font sizes.
- Colours - none. Every colour token is redefined by the themes, so no literal equals one in both;
  the literals that repeat are already local tokens (the sliders' own palette) or single uses.

`tokens.css` also held element rules (`*`, `html`, `body`, focus ring, scrollbars); they moved to the
top of `base.css`, which is loaded right after it.

## Checks

| | baseline | phase 3 |
|---|---|---|
| typecheck / lint / Prettier | clean | clean |
| `npm test` | 694 passed, 2 skipped | 694 passed, 2 skipped |
| e2e | 1 | 1 passed |
| live-model topics check | passed | passed |
| screenshots vs phase 0 | - | same (noise: Templates 97 px, home 6 px, graph 2 px) |
| computed styles vs pre-phase-3 build | - | identical on all elements of all 36 screens |
| topics run | - | byte-identical |

The snapshot script also got sturdier: each step now waits for what it should have done (a closed
dialog, the home overlay, the Statistics pane) and fails loudly instead of photographing the wrong
screen - which it did once, silently, in the baseline run for this phase.

Bugs logged: none.
