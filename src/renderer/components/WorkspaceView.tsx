import { useCallback, useRef } from 'react'
import { getView, viewTitle } from '../core/view-registry'
import type { SplitNode, TabsNode, Workspace, WorkspaceNode } from '../core/workspace'
import { Icon } from './Icon'
import { Tip } from './Tip'
import { ViewBoundary } from './ViewBoundary'

/**
 * Renders the workspace tree. Recursive and dumb: it reads the tree and calls
 * mutators, it never owns layout state itself.
 */

type Props = {
  workspace: Workspace
  node?: WorkspaceNode
  /**
   * Bumped on every layout change. Passed as a prop rather than used as a
   * `key`: keying here would remount the whole tree on every change, which
   * destroys each view's internal state - cursor position, scroll, and (from
   * 1.6) CodeMirror's undo history - every time you click into another pane.
   */
  revision?: number | undefined
}

export function WorkspaceView({ workspace, node, revision }: Props): React.ReactElement | null {
  const target = node ?? workspace.getRoot()
  if (target.kind === 'split') return <Split workspace={workspace} node={target} revision={revision} />
  if (target.kind === 'tabs') return <Tabs workspace={workspace} node={target} revision={revision} />
  return null
}

function Split({
  workspace,
  node,
  revision,
}: {
  workspace: Workspace
  node: SplitNode
  revision?: number | undefined
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const horizontal = node.direction === 'horizontal'

  // Drag a divider: recompute the two adjacent fractions from pointer position.
  const startDrag = useCallback(
    (index: number, ev: React.PointerEvent) => {
      ev.preventDefault()
      const container = ref.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const total = horizontal ? rect.height : rect.width
      const start = horizontal ? ev.clientY - rect.top : ev.clientX - rect.left
      const pair = (node.sizes[index] ?? 0) + (node.sizes[index + 1] ?? 0)

      const onMove = (move: PointerEvent): void => {
        const at = horizontal ? move.clientY - rect.top : move.clientX - rect.left
        const delta = (at - start) / total
        const first = Math.min(Math.max((node.sizes[index] ?? 0) + delta, 0.08), pair - 0.08)
        const next = [...node.sizes]
        next[index] = first
        next[index + 1] = pair - first
        workspace.setSizes(node.id, next)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.classList.remove('is-resizing')
      }
      document.body.classList.add('is-resizing')
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [workspace, node, horizontal],
  )

  return (
    <div ref={ref} className={`split split--${node.direction}`}>
      {node.children.map((child, i) => (
        <div key={child.id} className="split__pane" style={{ flexBasis: `${(node.sizes[i] ?? 0) * 100}%` }}>
          <WorkspaceView workspace={workspace} node={child} revision={revision} />
          {i < node.children.length - 1 && (
            <div
              className="split__divider"
              role="separator"
              aria-orientation={horizontal ? 'horizontal' : 'vertical'}
              onPointerDown={(ev) => startDrag(i, ev)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function Tabs({
  workspace,
  node,
  revision,
}: {
  workspace: Workspace
  node: TabsNode
  revision?: number | undefined
}): React.ReactElement {
  const active = node.children[node.active]
  const activeLeafId = workspace.activeLeaf?.id
  const isFocusedGroup = active !== undefined && active.id === activeLeafId

  return (
    <div className={`tabs${isFocusedGroup ? ' is-focused' : ''}`}>
      <div className="tabs__bar">
        <div className="tabs__strip" role="tablist">
        {node.children.map((leaf, i) => (
          <div
            key={leaf.id}
            role="tab"
            aria-selected={i === node.active}
            tabIndex={0}
            className={`tab${i === node.active ? ' is-active' : ''}`}
            onMouseDown={() => workspace.setActiveTab(node.id, i)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') workspace.setActiveTab(node.id, i)
            }}
            onAuxClick={(ev) => {
              if (ev.button === 1) workspace.closeLeaf(leaf.id) // middle-click closes
            }}
          >
            <span className="tab__title">{viewTitle(leaf.type, leaf.state)}</span>
            <button
              className="tab__close"
              aria-label={`Close ${viewTitle(leaf.type, leaf.state)}`}
              onMouseDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => {
                ev.stopPropagation()
                workspace.closeLeaf(leaf.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
        </div>
        {node.children.length > 1 && (
          <Tip label="Close other tabs" hint="Keeps the one you are in" placement="bottom">
            <button
              className="tabs__clear"
              aria-label="Close other tabs"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => workspace.closeAll(active === undefined ? {} : { except: active.id })}
            >
              <Icon name="list-x" size={15} />
            </button>
          </Tip>
        )}
      </div>
      <div className="tabs__content" role="tabpanel">
        {active ? <Leaf key={active.id} workspace={workspace} leafId={active.id} /> : <EmptyPane />}
      </div>
    </div>
  )
}

function Leaf({ workspace, leafId }: { workspace: Workspace; leafId: string }): React.ReactElement {
  const leaf = workspace.getLeaf(leafId)
  if (!leaf) return <EmptyPane />

  const def = getView(leaf.type)
  if (!def) return <UnknownView type={leaf.type} />

  return (
    <div className="leaf" onMouseDown={() => workspace.setActiveLeaf(leaf.id)}>
      <ViewBoundary label={leafLabel(leaf)} onClose={() => workspace.closeLeaf(leaf.id)}>
        {def.render({
          state: leaf.state,
          leafId: leaf.id,
          setState: (next) => workspace.setLeafState(leaf.id, next),
        })}
      </ViewBoundary>
    </div>
  )
}

/** What to call a tab in an error message: its file, or its view type. */
function leafLabel(leaf: { type: string; state: unknown }): string {
  const path = (leaf.state as { path?: unknown } | null)?.path
  return typeof path === 'string' && path !== '' ? path : leaf.type
}

function EmptyPane(): React.ReactElement {
  return (
    <div className="pane-empty">
      <p>
        Pick a note from the sidebar, or press <kbd>⌘N</kbd> for a new one.
        <br />
        <kbd>⌘P</kbd> opens the command palette.
      </p>
    </div>
  )
}

/**
 * A leaf whose view type is not registered. Rendering a placeholder instead of
 * throwing is the whole reason the registry is keyed by string: a saved layout
 * survives a view that no longer exists.
 */
function UnknownView({ type }: { type: string }): React.ReactElement {
  return (
    <div className="pane-empty">
      <p>
        Unknown view type <code>{type}</code>.
        <br />
        Its tab is kept so the rest of your layout is not lost.
      </p>
    </div>
  )
}
