import { createRoot, type Root } from 'react-dom/client'
import { ContextMenu, type MenuItem } from './ContextMenu'

/**
 * The app's context menu, opened from code that is not React - a CodeMirror
 * widget, say. One root for the whole window; opening a menu replaces the
 * last one, as a right-click elsewhere would.
 */

let root: Root | null = null

export function openMenu(items: readonly MenuItem[], at: { x: number; y: number }, onClosed?: () => void): void {
  if (root === null) {
    const host = document.createElement('div')
    host.className = 'menu-host'
    document.body.append(host)
    root = createRoot(host)
  }
  const close = (): void => {
    root?.render(null)
    onClosed?.()
  }
  root.render(<ContextMenu key={`${at.x},${at.y},${Date.now()}`} items={items} at={at} onClose={close} />)
}
