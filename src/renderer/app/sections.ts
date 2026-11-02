/**
 * The three workspaces.
 *
 * Switching section swaps the *entire* workspace - its own tabs, its own splits,
 * its own sidebar list - not just the sidebar panel. Data, Canvas and Tasks are
 * three separate places to be, which is why they are a segmented control at the
 * top of the sidebar rather than an icon rail. Canvas is a placeholder for now.
 *
 * Chats are not a section any more: they live in the Chats panel on the right,
 * beside whatever you are working on (features/chats).
 *
 * Home and Graph are deliberately NOT sections. They are extensions: Home opens
 * as a tab anywhere, Graph docks to the right of whichever workspace you are in
 * (or takes a full tab when you want it big). Making either a section would add
 * a fourth and fifth place to be, for things you glance at.
 */
export type SectionId = 'data' | 'canvas' | 'tasks'

type Section = {
  id: SectionId
  label: string
  /** Lucide icon name, resolved in the sidebar tabs. */
  icon: string
  /** The view this section opens by default. */
  viewType: string
  /** Placeholder in the sidebar's search box. */
  searchPlaceholder: string
  /**
   * Label on the sidebar's "new" button. Kept short: it sits beside a second
   * button, and "New note" truncates to "New n..." at the default width.
   * Empty: the section has no "new".
   */
  newLabel: string
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'data',
    label: 'Data',
    icon: 'book-open',
    viewType: 'markdown',
    searchPlaceholder: 'Search files…',
    newLabel: 'Note',
  },
  {
    id: 'canvas',
    label: 'Canvas',
    icon: 'scan',
    viewType: 'canvas',
    searchPlaceholder: 'Search canvases…',
    newLabel: '',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'square-kanban',
    viewType: 'board',
    // Boards, not cards: the box filters the list beside it, the same as it
    // does in Data. Finding a card by name is what the quick switcher is for.
    searchPlaceholder: 'Search boards…',
    newLabel: 'Task',
  },
]

export const DEFAULT_SECTION: SectionId = 'data'

export const getSection = (id: SectionId): Section => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]!

export const isSectionId = (value: unknown): value is SectionId => typeof value === 'string' && SECTIONS.some((s) => s.id === value)

/**
 * Views that are not a section: they open inside whichever section you are in.
 * Settings is not here: it is a dialog, not something that takes a tab.
 */
export const EXTENSION_VIEWS = ['home', 'graph', 'profile', 'archive', 'unresolved'] as const
