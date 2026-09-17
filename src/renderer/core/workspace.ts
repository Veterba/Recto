import { Events } from './events'

/**
 * The workspace tree: split -> tabs -> leaf.
 *
 * Every node is plain serialisable data and every leaf is `{type, state}`, so
 * the whole layout round-trips through workspace.json and a view type is only
 * resolved at render time. This shape cannot be retrofitted - splits, tabs and
 * multi-pane everything all assume it - so it exists before any view does.
 */

export type LeafNode = {
  kind: 'leaf'
  id: string
  type: string
  state: Record<string, unknown>
}

export type TabsNode = {
  kind: 'tabs'
  id: string
  children: LeafNode[]
  /** Index into `children`. Clamped on every mutation. */
  active: number
}

export type SplitNode = {
  kind: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: WorkspaceNode[]
  /** Fractions summing to 1, one per child. */
  sizes: number[]
}

export type WorkspaceNode = LeafNode | TabsNode | SplitNode
export type WorkspaceContainer = TabsNode | SplitNode

export type WorkspaceLayout = {
  version: 1
  root: WorkspaceContainer
  activeLeafId: string | null
}

type WorkspaceEvents = {
  'layout-change': readonly []
  'active-leaf-change': readonly [leaf: LeafNode | null]
}

let counter = 0
const nextId = (prefix: string): string => `${prefix}-${(++counter).toString(36)}${Date.now().toString(36).slice(-4)}`

export function makeLeaf(type: string, state: Record<string, unknown> = {}): LeafNode {
  return { kind: 'leaf', id: nextId('leaf'), type, state }
}

export function makeTabs(children: LeafNode[] = [], active = 0): TabsNode {
  return { kind: 'tabs', id: nextId('tabs'), children, active }
}

export function makeSplit(direction: SplitNode['direction'], children: WorkspaceNode[]): SplitNode {
  return { kind: 'split', id: nextId('split'), direction, children, sizes: evenSizes(children.length) }
}

const evenSizes = (n: number): number[] => (n === 0 ? [] : Array.from({ length: n }, () => 1 / n))

export class Workspace extends Events<WorkspaceEvents> {
  private root: WorkspaceContainer
  private activeLeafId: string | null = null

  constructor(layout?: WorkspaceLayout) {
    super()
    this.root = layout?.root ?? makeTabs()
    this.activeLeafId = layout?.activeLeafId ?? this.firstLeaf()?.id ?? null
  }

  getRoot(): WorkspaceContainer {
    return this.root
  }

  serialize(): WorkspaceLayout {
    return { version: 1, root: this.root, activeLeafId: this.activeLeafId }
  }

  /** Every leaf, depth-first, left to right. */
  leaves(node: WorkspaceNode = this.root): LeafNode[] {
    if (node.kind === 'leaf') return [node]
    return node.children.flatMap((child) => this.leaves(child))
  }

  firstLeaf(): LeafNode | null {
    return this.leaves()[0] ?? null
  }

  getLeaf(id: string): LeafNode | null {
    return this.leaves().find((leaf) => leaf.id === id) ?? null
  }

  get activeLeaf(): LeafNode | null {
    return this.activeLeafId === null ? null : this.getLeaf(this.activeLeafId)
  }

  setActiveLeaf(id: string | null): void {
    if (this.activeLeafId === id) return
    this.activeLeafId = id
    // Keep the owning tab group pointed at it, so activating a leaf in a
    // background split actually reveals it.
    if (id !== null) {
      const tabs = this.tabsContaining(id)
      if (tabs) {
        const i = tabs.children.findIndex((leaf) => leaf.id === id)
        if (i !== -1) tabs.active = i
      }
    }
    this.trigger('active-leaf-change', this.activeLeaf)
    this.trigger('layout-change')
  }

  /** The tabs group a leaf lives in. */
  tabsContaining(leafId: string, node: WorkspaceNode = this.root): TabsNode | null {
    if (node.kind === 'leaf') return null
    if (node.kind === 'tabs') {
      return node.children.some((leaf) => leaf.id === leafId) ? node : null
    }
    for (const child of node.children) {
      const found = this.tabsContaining(leafId, child)
      if (found) return found
    }
    return null
  }

  /**
   * Open a view. Reuses an existing leaf of the same type+state when
   * `reuse` is set, which is what stops ⌘P from stacking ten Settings tabs.
   */
  openView(
    type: string,
    state: Record<string, unknown> = {},
    options: { reuse?: boolean; inTabs?: string } = {},
  ): LeafNode {
    if (options.reuse !== false) {
      const existing = this.leaves().find(
        (leaf) => leaf.type === type && JSON.stringify(leaf.state) === JSON.stringify(state),
      )
      if (existing) {
        this.setActiveLeaf(existing.id)
        return existing
      }
    }

    const target =
      (options.inTabs !== undefined ? this.findTabs(options.inTabs) : null) ??
      (this.activeLeafId !== null ? this.tabsContaining(this.activeLeafId) : null) ??
      this.firstTabs() ??
      this.ensureTabs()

    const leaf = makeLeaf(type, state)
    target.children.push(leaf)
    target.active = target.children.length - 1
    this.setActiveLeaf(leaf.id)
    this.trigger('layout-change')
    return leaf
  }

  closeLeaf(id: string): void {
    const tabs = this.tabsContaining(id)
    if (!tabs) return
    const i = tabs.children.findIndex((leaf) => leaf.id === id)
    if (i === -1) return

    tabs.children.splice(i, 1)
    tabs.active = Math.max(0, Math.min(tabs.active, tabs.children.length - 1))

    if (tabs.children.length === 0) this.pruneEmpty()

    if (this.activeLeafId === id) {
      const next = tabs.children[tabs.active] ?? this.firstLeaf()
      this.activeLeafId = next?.id ?? null
      this.trigger('active-leaf-change', this.activeLeaf)
    }
    this.trigger('layout-change')
  }

  /**
   * Close every tab in the group that holds `leafId` - or in every group.
   *
   * One layout change rather than one per tab, so the workspace is saved once
   * and nothing flickers through half-closed states.
   */
  closeAll(options: { except?: string } = {}): void {
    const keep = options.except
    for (const leaf of this.leaves()) {
      if (leaf.id === keep) continue
      const tabs = this.tabsContaining(leaf.id)
      if (!tabs) continue
      const i = tabs.children.findIndex((child) => child.id === leaf.id)
      if (i !== -1) tabs.children.splice(i, 1)
    }
    for (const tabs of this.allTabs()) tabs.active = Math.max(0, Math.min(tabs.active, tabs.children.length - 1))
    this.pruneEmpty()
    const next = this.firstLeaf()
    if (this.activeLeafId !== next?.id) {
      this.activeLeafId = next?.id ?? null
      this.trigger('active-leaf-change', this.activeLeaf)
    }
    this.trigger('layout-change')
  }

  /**
   * Drop tabs whose note is gone - deleted, or renamed by another app.
   *
   * A workspace is restored from disk, so it outlives the notes in it: without
   * this, every note ever opened stayed in the bar forever, and clicking one
   * showed "could not open". Returns how many went.
   */
  pruneMissing(exists: (path: string) => boolean): number {
    const gone = this.leaves().filter((leaf) => {
      const path = (leaf.state as { path?: unknown }).path
      return typeof path === 'string' && path !== '' && !exists(path)
    })
    for (const leaf of gone) this.closeLeaf(leaf.id)
    return gone.length
  }

  /** Every tabs group in the tree. */
  allTabs(node: WorkspaceNode = this.root): TabsNode[] {
    if (node.kind === 'tabs') return [node]
    if (node.kind === 'leaf') return []
    return node.children.flatMap((child) => this.allTabs(child))
  }

  /** Split the group containing `leafId`, moving a copy of that leaf into the new pane. */
  splitLeaf(leafId: string, direction: SplitNode['direction']): LeafNode | null {
    const leaf = this.getLeaf(leafId)
    const tabs = this.tabsContaining(leafId)
    if (!leaf || !tabs) return null

    const copy = makeLeaf(leaf.type, { ...leaf.state })
    const newTabs = makeTabs([copy], 0)
    const parent = this.parentOf(tabs.id)

    if (parent === null) {
      // Splitting the root tabs group: wrap both in a new root split.
      this.root = makeSplit(direction, [tabs, newTabs])
    } else if (parent.direction === direction) {
      const at = parent.children.indexOf(tabs)
      parent.children.splice(at + 1, 0, newTabs)
      parent.sizes = evenSizes(parent.children.length)
    } else {
      const at = parent.children.indexOf(tabs)
      parent.children[at] = makeSplit(direction, [tabs, newTabs])
    }

    this.setActiveLeaf(copy.id)
    this.trigger('layout-change')
    return copy
  }

  /** Move a leaf into another tabs group, at an index. Powers tab drag-drop. */
  moveLeaf(leafId: string, toTabsId: string, index?: number): void {
    const from = this.tabsContaining(leafId)
    const to = this.findTabs(toTabsId)
    if (!from || !to) return
    const i = from.children.findIndex((leaf) => leaf.id === leafId)
    if (i === -1) return
    const [leaf] = from.children.splice(i, 1)
    if (!leaf) return
    const at = index ?? to.children.length
    to.children.splice(Math.max(0, Math.min(at, to.children.length)), 0, leaf)
    to.active = to.children.indexOf(leaf)
    from.active = Math.max(0, Math.min(from.active, from.children.length - 1))
    if (from.children.length === 0) this.pruneEmpty()
    this.trigger('layout-change')
  }

  setSizes(splitId: string, sizes: number[]): void {
    const node = this.findNode(splitId)
    if (node?.kind !== 'split') return
    const total = sizes.reduce((a, b) => a + b, 0)
    if (total <= 0) return
    node.sizes = sizes.map((s) => s / total)
    this.trigger('layout-change')
  }

  setLeafState(leafId: string, state: Record<string, unknown>): void {
    const leaf = this.getLeaf(leafId)
    if (!leaf) return
    leaf.state = state
    this.trigger('layout-change')
  }

  setActiveTab(tabsId: string, index: number): void {
    const tabs = this.findTabs(tabsId)
    if (!tabs) return
    tabs.active = Math.max(0, Math.min(index, tabs.children.length - 1))
    const leaf = tabs.children[tabs.active]
    this.setActiveLeaf(leaf?.id ?? null)
  }

  // --- tree helpers ---

  private findNode(id: string, node: WorkspaceNode = this.root): WorkspaceNode | null {
    if (node.id === id) return node
    if (node.kind === 'leaf') return null
    for (const child of node.children) {
      const found = this.findNode(id, child)
      if (found) return found
    }
    return null
  }

  private findTabs(id: string): TabsNode | null {
    const node = this.findNode(id)
    return node?.kind === 'tabs' ? node : null
  }

  private firstTabs(node: WorkspaceNode = this.root): TabsNode | null {
    if (node.kind === 'leaf') return null
    if (node.kind === 'tabs') return node
    for (const child of node.children) {
      const found = this.firstTabs(child)
      if (found) return found
    }
    return null
  }

  private ensureTabs(): TabsNode {
    const tabs = makeTabs()
    if (this.root.kind === 'split') this.root.children.push(tabs)
    else this.root = tabs
    return tabs
  }

  private parentOf(id: string, node: WorkspaceNode = this.root): SplitNode | null {
    if (node.kind !== 'split') return null
    if (node.children.some((child) => child.id === id)) return node
    for (const child of node.children) {
      const found = this.parentOf(id, child)
      if (found) return found
    }
    return null
  }

  /**
   * Drop empty tabs groups and collapse splits that no longer branch. Without
   * this, closing tabs leaves invisible zero-width panes behind forever.
   */
  private pruneEmpty(): void {
    const prune = (node: WorkspaceNode): WorkspaceNode | null => {
      if (node.kind === 'leaf') return node
      if (node.kind === 'tabs') return node.children.length > 0 ? node : null
      const kept = node.children.map(prune).filter((child): child is WorkspaceNode => child !== null)
      if (kept.length === 0) return null
      if (kept.length === 1) return kept[0] ?? null
      node.children = kept
      node.sizes = evenSizes(kept.length)
      return node
    }

    const pruned = prune(this.root)
    if (pruned === null) this.root = makeTabs()
    else if (pruned.kind === 'leaf') this.root = makeTabs([pruned], 0)
    else this.root = pruned
  }
}
