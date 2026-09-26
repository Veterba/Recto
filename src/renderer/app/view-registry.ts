import type { Component } from './component'

/**
 * View types are looked up by string id, never imported directly by the
 * workspace. That is what makes `workspace.json` survive a view type that no
 * longer exists: the leaf deserialises, the lookup misses, and we render a
 * placeholder instead of throwing away the user's layout.
 */

export type ViewProps = {
  /** Opaque per-leaf state, persisted verbatim into workspace.json. */
  state: Record<string, unknown>
  setState: (next: Record<string, unknown>) => void
  leafId: string
}

export type ViewDefinition = {
  type: string
  /** Fallback tab title when the view does not derive one from its state. */
  title: string
  icon?: string
  /** Title shown in the tab, given the leaf's state. */
  getTitle?: (state: Record<string, unknown>) => string
  render: (props: ViewProps) => React.ReactElement
  /** Optional non-React lifecycle for views that own their own DOM (CM6, Pixi). */
  createComponent?: () => Component
}

const registry = new Map<string, ViewDefinition>()

export function registerView(def: ViewDefinition): () => void {
  registry.set(def.type, def)
  return () => registry.delete(def.type)
}

export function getView(type: string): ViewDefinition | undefined {
  return registry.get(type)
}

export function viewTitle(type: string, state: Record<string, unknown>): string {
  const def = registry.get(type)
  if (!def) return 'Unknown'
  return def.getTitle?.(state) ?? def.title
}

export function listViews(): ViewDefinition[] {
  return [...registry.values()]
}
