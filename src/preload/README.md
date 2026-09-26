# src/preload

The bridge between the renderer and main: one object on `window.api`, with `invoke(channel, ...args)`
and `on(channel, listener)`.

It lets through only the channels listed in `shared/ipc.ts`, and never passes the renderer the
`IpcRendererEvent` (it carries `sender`, a way back into main outside this bridge).

**Must not be imported from here:** nothing imports this folder; Electron loads it into the window.
Keep it to the bridge - no app logic, no imports but `electron` and `shared/ipc.ts`.
