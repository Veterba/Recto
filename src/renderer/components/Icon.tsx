import {
  CircleUser,
  FolderTree,
  GitFork,
  House,
  Settings,
  Sparkles,
  SquareKanban,
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
  house: House,
  'folder-tree': FolderTree,
  sparkles: Sparkles,
  'square-kanban': SquareKanban,
  'git-fork': GitFork,
  'circle-user': CircleUser,
  settings: Settings,
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
