import {
  BookOpen,
  CircleUser,
  FilePlus,
  FolderPlus,
  GitFork,
  House,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquareKanban,
  X,
  type LucideIcon,
} from 'lucide-react'

/**
 * Icons by name, so a section or command can carry a string instead of a
 * component.
 *
 * Imported one by one on purpose. Reaching for lucide's `icons` barrel export
 * pulls in all ~1,600 of them and took the renderer bundle from 648 kB to
 * 1.88 MB - every icon in the library, in the startup path, to draw seven.
 * Add a line here when a new icon is needed.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  'book-open': BookOpen,
  sparkles: Sparkles,
  'square-kanban': SquareKanban,
  house: House,
  'git-fork': GitFork,
  'circle-user': CircleUser,
  settings: Settings,
  'file-plus': FilePlus,
  'folder-plus': FolderPlus,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  'panel-right-close': PanelRightClose,
  maximize: Maximize2,
  search: Search,
  plus: Plus,
  x: X,
}

type Props = {
  name: string
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 18, strokeWidth = 1.75, className }: Props): React.ReactElement | null {
  const Component = ICONS[name]
  if (!Component) return null
  return <Component size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
}
