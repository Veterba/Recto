import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IPC } from '@shared/ipc'
import { api } from '../api'
import { getView, viewTitle } from '../view-registry'
import type { LeafNode, TabsNode, Workspace } from '../workspace'
import { folderHints } from '../tab-labels'
import { revealInTree } from '../reveal-in-tree'
import { beginPaneDrag } from '../pane-drag'
import { Icon } from '../../ui/Icon'
import { commands } from '../commands'
import { toggleChats, useChatsOpen } from '../../features/chats/chats-store'
import { Tip, placeTip } from '../../ui/Tip'
import { ContextMenu, useContextMenu, type MenuItem } from '../../ui/ContextMenu'
import { pressOrDrag } from '../../ui/press-or-drag'
import { fuzzyFilter } from '../../ui/fuzzy'
import { pickerKeyDown, usePicker, useScrollSelected } from '../../ui/picker'
import { useMetaHeld } from '../../ui/meta-key'

/**
 * A pane's row of tabs.
 *
 * Tabs shrink to a minimum width and then the row scrolls sideways - the wheel
 * scrolls it too, not only a trackpad's sideways swipe. Once it scrolls, a
 * button at the right lists every tab in the pane with a search field. Pinned
 * tabs sit at the left as icons and survive "close others". Dragging a tab
 * along the row reorders it; dragging it onto a pane moves it there.
 */

const pathOf = (leaf: LeafNode): string | null => {
  const path = leaf.state['path']
  return typeof path === 'string' && path !== '' ? path : null
}

const iconOf = (leaf: LeafNode): string => getView(leaf.type)?.icon ?? (pathOf(leaf) !== null ? 'file-text' : 'file')

export function TabBar({ workspace, node }: { workspace: Workspace; node: TabsNode }): React.ReactElement {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const menu = useContextMenu<LeafNode>()
  const active = node.children[node.active]
  const [hovered, setHovered] = useState<{ leafId: string; anchor: HTMLElement; label: string } | null>(null)
  const metaHeld = useMetaHeld()

  // Names are compared across every pane: two "Ideas" tabs side by side in a split are as confusing as in one row.
  const hints = folderHints(
    workspace.leaves().map((leaf) => ({ id: leaf.id, title: viewTitle(leaf.type, leaf.state), path: pathOf(leaf) })),
  )

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const check = (): void => setOverflowing(strip.scrollWidth > strip.clientWidth + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [node.children.length])

  // The tab you are in stays in view as the row scrolls past it.
  useEffect(() => {
    stripRef.current?.querySelector('.tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [node.active, node.children.length])

  const menuItems = (leaf: LeafNode): MenuItem[] => {
    const i = node.children.indexOf(leaf)
    const path = pathOf(leaf)
    return [
      { kind: 'item', label: 'Close', icon: 'x', run: () => workspace.closeLeaf(leaf.id) },
      { kind: 'item', label: 'Close others', icon: 'list-x', run: () => workspace.closeAll({ except: leaf.id }) },
      {
        kind: 'item',
        label: 'Close to the right',
        icon: 'arrow-right',
        disabled: !node.children.slice(i + 1).some((other) => !other.pinned),
        run: () => workspace.closeToRight(leaf.id),
      },
      { kind: 'separator' },
      leaf.pinned
        ? { kind: 'item', label: 'Unpin', icon: 'pin-off', run: () => workspace.setPinned(leaf.id, false) }
        : { kind: 'item', label: 'Pin', icon: 'pin', run: () => workspace.setPinned(leaf.id, true) },
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Copy link',
        icon: 'link',
        disabled: path === null,
        run: () => {
          if (path !== null) // A link to paste anywhere: as Obsidian writes one from no note, by the vault's link settings.
            void api.invoke(IPC.linksFormat, path, '').then((link) => navigator.clipboard.writeText(link)).catch(() => {})
        },
      },
      {
        kind: 'item',
        label: 'Reveal in tree',
        icon: 'list-tree',
        disabled: path === null,
        run: () => {
          if (path === null) return
          workspace.setActiveLeaf(leaf.id)
          revealInTree(path)
        },
      },
    ]
  }

  return (
    <div className="tabs__bar">
      <div
        ref={stripRef}
        className={`tabs__strip${overflowing ? ' is-overflowing' : ''}`}
        role="tablist"
        // A mouse wheel scrolls vertically; the row only goes sideways.
        onWheel={(ev) => {
          if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) ev.currentTarget.scrollLeft += ev.deltaY
        }}
      >
        {node.children.map((leaf, i) => {
          const title = viewTitle(leaf.type, leaf.state)
          const hint = hints.get(leaf.id)
          const path = pathOf(leaf)
          return (
            <div
              key={leaf.id}
              role="tab"
              aria-selected={i === node.active}
              aria-label={title}
              tabIndex={0}
              data-leaf-id={leaf.id}
              className={`tab${i === node.active ? ' is-active' : ''}${leaf.pinned ? ' is-pinned' : ''}`}
              onMouseDown={(ev) => {
                if (ev.button === 0) workspace.setActiveTab(node.id, i)
              }}
              // Dragged along the row, the tab reorders; onto a pane, it moves there - or splits it.
              onPointerDown={(ev) => {
                if ((ev.target as HTMLElement).closest('.tab__close') !== null) return
                pressOrDrag(ev, {
                  onDrag: (x, y) => beginPaneDrag({ kind: 'leaf', leafId: leaf.id }, title, x, y),
                })
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') workspace.setActiveTab(node.id, i)
              }}
              onAuxClick={(ev) => {
                if (ev.button === 1) workspace.closeLeaf(leaf.id) // middle-click closes
              }}
              onContextMenu={(ev) => menu.open(ev, leaf)}
              onPointerEnter={(ev) => setHovered({ leafId: leaf.id, anchor: ev.currentTarget, label: path ?? title })}
              onPointerLeave={() => setHovered(null)}
            >
              {leaf.pinned ? (
                <Icon name={iconOf(leaf)} size={14} />
              ) : (
                <>
                  <span className="tab__title">{title}</span>
                  {hint !== undefined && <span className="tab__folder">{hint}</span>}
                  <button
                    className="tab__close"
                    aria-label={`Close ${title}`}
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      workspace.closeLeaf(leaf.id)
                    }}
                  >
                    ×
                  </button>
                </>
              )}
              <span className="tab__mark" aria-hidden="true" />
            </div>
          )
        })}
        <Tip label="New tab" placement="bottom">
          <button
            className="tabs__new"
            aria-label="New tab"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => workspace.openView('new-tab', {}, { reuse: false, inTabs: node.id })}
          >
            <Icon name="plus" size={15} />
          </button>
        </Tip>
      </div>
      {hovered !== null && metaHeld && <PathTip anchor={hovered.anchor} label={hovered.label} />}
      {overflowing && (
        <div className="tabs__more-anchor">
          <Tip label="All tabs" placement="bottom">
            <button
              className="tabs__clear"
              aria-label="All tabs"
              aria-expanded={listOpen}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => setListOpen((open) => !open)}
            >
              <Icon name="chevron-down" size={15} />
            </button>
          </Tip>
          {listOpen && (
            <TabList
              tabs={node.children}
              active={active?.id}
              hints={hints}
              onPick={(leaf) => {
                workspace.setActiveLeaf(leaf.id)
                setListOpen(false)
              }}
              onClose={() => setListOpen(false)}
            />
          )}
        </div>
      )}
      {workspace.topRightTabs()?.id === node.id && <ChatsToggle />}
      {node.children.length > 1 && (
        <Tip label="Close other tabs" hint="Keeps the one you are in and pinned tabs" placement="bottom">
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
      {menu.menu !== null && <ContextMenu items={menuItems(menu.menu.subject)} at={menu.menu.at} onClose={menu.close} />}
    </div>
  )
}

/**
 * A tab's path, shown while ⌘ is held over it. Not on plain hover: sweeping
 * across the row would flash a tooltip on every tab it passed.
 */
function PathTip({ anchor, label }: { anchor: HTMLElement; label: string }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (ref.current !== null) setAt(placeTip(anchor.getBoundingClientRect(), ref.current.getBoundingClientRect(), 'bottom'))
  }, [anchor, label])
  return createPortal(
    <div className="tip" ref={ref} role="tooltip" style={{ left: at.x, top: at.y }}>
      <span className="tip__label">{label}</span>
    </div>,
    document.body,
  )
}

/** Every tab in the pane, searchable: the way to a tab scrolled out of the row. */
function TabList({
  tabs,
  active,
  hints,
  onPick,
  onClose,
}: {
  tabs: readonly LeafNode[]
  active: string | undefined
  hints: ReadonlyMap<string, string>
  onPick: (leaf: LeafNode) => void
  onClose: () => void
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const { query, setQuery, cursor, setCursor, inputRef, listRef } = usePicker(true)
  const results = fuzzyFilter(query, tabs, (leaf) => viewTitle(leaf.type, leaf.state)).map((scored) => scored.item)
  useScrollSelected(listRef, cursor, results)

  // A press anywhere else closes it, the way a menu closes.
  useEffect(() => {
    const onDown = (ev: MouseEvent): void => {
      const target = ev.target as Node
      if (ref.current?.contains(target) || ref.current?.parentElement?.contains(target)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  return (
    <div ref={ref} className="tabs__list glass-surface" role="dialog" aria-label="All tabs">
      <input
        ref={inputRef}
        className="tabs__list-search"
        placeholder="Find a tab"
        value={query}
        onChange={(ev) => setQuery(ev.target.value)}
        onKeyDown={(ev) =>
          pickerKeyDown(ev, {
            count: results.length,
            cursor,
            setCursor,
            pick: (i) => {
              const leaf = results[i]
              if (leaf !== undefined) onPick(leaf)
            },
            close: onClose,
          })
        }
      />
      <ul ref={listRef} className="tabs__list-items" role="listbox">
        {results.map((leaf, i) => (
          <li
            key={leaf.id}
            role="option"
            aria-selected={i === cursor}
            className={`tabs__list-item${leaf.id === active ? ' is-active' : ''}`}
            onMouseEnter={() => setCursor(i)}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick(leaf)}
          >
            <Icon name={iconOf(leaf)} size={14} />
            <span className="tab__title">{viewTitle(leaf.type, leaf.state)}</span>
            {hints.has(leaf.id) && <span className="tab__folder">{hints.get(leaf.id)}</span>}
            {leaf.pinned && <Icon name="pin" size={12} />}
          </li>
        ))}
        {results.length === 0 && <li className="tabs__list-empty">No tab matches</li>}
      </ul>
    </div>
  )
}

/** The Chats panel's button, at the right end of the top-right tab bar. */
function ChatsToggle(): React.ReactElement | null {
  const open = useChatsOpen()
  // Open, the panel has its own close button: one button per job.
  if (open) return null
  return (
    <Tip label="Chats" hint={commands.label('chats:toggle') ?? undefined} placement="bottom">
      <button
        className="tabs__clear tabs__chats"
        aria-label="Open chats"
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={toggleChats}
      >
        <Icon name="messages-square" size={15} />
      </button>
    </Tip>
  )
}
