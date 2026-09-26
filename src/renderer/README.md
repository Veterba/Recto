# src/renderer

The React app. No Node, no Electron: everything it needs from the disk goes through `app/api.ts`
(`window.api` from the preload).

- `app/` - the shell: workspace and tabs, sidebar, status bar, command palette and hotkeys, the
  view registry, the stores (vault tree, appearance, note bus), and the hooks that wire the shell.
  `main.tsx` is the entry and imports the global stylesheets in cascade order.
- `features/<name>/` - one folder per feature, with `components/`, `hooks/`, `styles/` and pure
  modules beside them. Its `index.ts` is its public entry and imports its CSS.
- `ui/` - primitives with no knowledge of the app: icons, tooltips, menus, dialogs, the colour
  editor, sliders, toggle, setting row, chip styles, tints, the fuzzy matcher, picker keys.
- `styles/` - tokens, element rules, layout, motion.

**Must not be imported from here:** nothing outside `src/renderer` imports it. Inside it, features
import other features only through their `index.ts`, and `ui/` imports neither `app/` nor any
feature.
