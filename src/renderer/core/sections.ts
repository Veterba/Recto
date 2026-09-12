/**
 * The three workspaces.
 *
 * Switching section swaps the *entire* workspace - its own tabs, its own splits,
 * its own sidebar list - not just the sidebar panel. Data, AI and Tasks are
 * three separate places to be, which is why they are a segmented control at the
 * top of the sidebar rather than an icon rail.
 *
 * Home and Graph are deliberately NOT sections. They are extensions: Home opens
 * as a tab anywhere, Graph docks to the right of whichever workspace you are in
 * (or takes a full tab when you want it big). Making either a section would add
 * a fourth and fifth place to be, for things you glance at.
 */
export type SectionId = 'data' | 'ai' | 'tasks'

export type Section = {
  id: SectionId
  label: string
  /** Lucide icon name, resolved in the sidebar tabs. */
  icon: string
  /** The view this section opens by default. */
  viewType: string
  /** Placeholder in the sidebar's search box. */
  searchPlaceholder: string
  /** Label on the sidebar's bottom-left "new" button. */
  newLabel: string
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'data',
    label: 'Data',
    icon: 'book-open',
    viewType: 'markdown',
    searchPlaceholder: 'Search files…',
    newLabel: 'New note',
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'sparkles',
    viewType: 'chat',
    searchPlaceholder: 'Search chats…',
    newLabel: 'New chat',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'square-kanban',
    viewType: 'board',
    searchPlaceholder: 'Search tasks…',
    newLabel: 'New task',
  },
]

export const DEFAULT_SECTION: SectionId = 'data'

export const getSection = (id: SectionId): Section =>
  SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]!

export const isSectionId = (value: unknown): value is SectionId =>
  typeof value === 'string' && SECTIONS.some((s) => s.id === value)

/** Views that are not a section: they open inside whichever section you are in. */
export const EXTENSION_VIEWS = ['home', 'graph', 'settings', 'profile', 'archive', 'unresolved'] as const
