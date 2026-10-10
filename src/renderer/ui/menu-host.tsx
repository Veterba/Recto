import { createRoot, type Root } from 'react-dom/client'

/**
 * A menu or popover opened from code that is not React - a CodeMirror widget,
 * say. One root for the whole window; opening one replaces the last, as a
 * right-click elsewhere would.
 */

let root: Root | null = null
let closeCurrent: (() => void) | null = null

export function openLayer(render: (close: () => void) => React.ReactElement, onClosed?: () => void): void {
  if (root === null) {
    const host = document.createElement('div')
    host.className = 'menu-host'
    document.body.append(host)
    root = createRoot(host)
  }
  // The one before is closed properly: whatever it highlighted is put back.
  closeCurrent?.()
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    if (closeCurrent === close) closeCurrent = null
    root?.render(null)
    onClosed?.()
  }
  closeCurrent = close
  root.render(render(close))
}
