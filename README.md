# Recto

A local-first knowledge app. Your notes are plain markdown files in a folder you
choose — readable by anything, yours to move, back up, or delete.

**No account. No sign-in. No server.** Nothing is uploaded anywhere, and there is
no analytics or phone-home of any kind.

## Status

Early. Milestone 1 (vault + editor + file tree) is in progress.

Done: the Electron skeleton — `contextIsolation: true`, `nodeIntegration: false`,
a preload that exposes one allowlisted `invoke` and nothing else, vault picking
and scaffolding, and the first-run screen.

Next: the workspace tree, the command/hotkey registry, the file explorer, the
SQLite indexer, and the CodeMirror 6 editor.

## Running from source

Requires Node 22+.

```sh
npm install
npm run dev
```

Other scripts: `npm run build`, `npm run typecheck`, `npm test`.

## Installing a build

Builds are unsigned for now, so macOS Gatekeeper will refuse to open the app
("… is damaged and can't be opened"). To run it anyway:

```sh
xattr -cr /Applications/Recto.app
```

That clears the quarantine attribute macOS adds to downloads. It is the standard
workaround for unsigned apps; a signed build needs an Apple Developer ID.

## Where your data lives

| What | Where |
|---|---|
| Your notes | the vault folder you picked — plain `.md`, nothing else |
| App state for that vault | `<vault>/.recto/` — one JSON file per feature |
| Search index | `<vault>/.recto/index.db` — **a cache.** Delete it and it rebuilds from your files. |
| Your Claude API key | your OS keychain, via Electron `safeStorage`. Never in the vault, never in the app bundle. |
| Last-opened vault, window state | your user app-data folder, per user |

A vault is safe to put in git. It contains no keys and no absolute paths.

## License

MIT — see [LICENSE](./LICENSE).
