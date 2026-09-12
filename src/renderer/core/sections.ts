/**
 * The left rail. One entry per top-level section of the app.
 *
 * A section is just a view type plus a sidebar panel, so "add a section" means
 * adding a row here - not touching the shell.
 */
export type SectionId = 'home' | 'data' | 'chat' | 'board' | 'graph' | 'settings' | 'profile'

export type Section = {
  id: SectionId
  label: string
  /** Lucide icon name, resolved in the rail. */
  icon: string
  /** The view this section opens in the main area. */
  viewType: string
  /** Sections pinned to the bottom of the rail. */
  footer?: boolean
  /** Sections with no sidebar panel of their own. */
  noPanel?: boolean
}

export const SECTIONS: readonly Section[] = [
  { id: 'home', label: 'Home', icon: 'house', viewType: 'home', noPanel: true },
  { id: 'data', label: 'Data', icon: 'folder-tree', viewType: 'markdown' },
  { id: 'chat', label: 'AI', icon: 'sparkles', viewType: 'chat' },
  { id: 'board', label: 'Tasks', icon: 'square-kanban', viewType: 'board' },
  { id: 'graph', label: 'Graph', icon: 'git-fork', viewType: 'graph', noPanel: true },
  { id: 'profile', label: 'Profile', icon: 'circle-user', viewType: 'profile', footer: true, noPanel: true },
  { id: 'settings', label: 'Settings', icon: 'settings', viewType: 'settings', footer: true, noPanel: true },
]

export const getSection = (id: SectionId): Section | undefined => SECTIONS.find((s) => s.id === id)

/**
 * Which section a view type belongs to.
 *
 * The rail is derived from what is actually open rather than stored on its own -
 * two sources of truth let the rail highlight "Data" while a Home tab was in
 * front of you.
 */
export const sectionForViewType = (viewType: string): Section | undefined =>
  SECTIONS.find((s) => s.viewType === viewType)
