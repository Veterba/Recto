import { formatChord } from '../core/hotkeys'
import { viewTitle } from '../core/view-registry'
import type { Workspace } from '../core/workspace'
import { Icon } from './Icon'

/**
 * Bottom strip. Deliberately sparse: it shows what is open and offers the
 * palette, and grows as later milestones get things worth reporting (word
 * count, index progress, sync state).
 */
type Props = {
  workspace: Workspace | null
  vaultName: string
  graphOpen: boolean
  onToggleGraph: () => void
  onOpenPalette: () => void
}

export function StatusBar({
  workspace,
  vaultName,
  graphOpen,
  onToggleGraph,
  onOpenPalette,
}: Props): React.ReactElement {
  const leaf = workspace?.activeLeaf ?? null
  const openCount = workspace?.leaves().length ?? 0

  return (
    <footer className="status">
      <span className="status__item status__item--vault">{vaultName}</span>
      <span className="status__sep" />
      <span className="status__item">{leaf ? viewTitle(leaf.type, leaf.state) : 'Nothing open'}</span>
      <span className="status__spacer" />
      <span className="status__item status__item--muted">
        {openCount} {openCount === 1 ? 'tab' : 'tabs'}
      </span>
      <button
        className={`status__btn${graphOpen ? ' is-on' : ''}`}
        onClick={onToggleGraph}
        title={`Graph (${formatChord('Mod+G')})`}
      >
        <Icon name="git-fork" size={13} />
      </button>
      <button className="status__btn" onClick={onOpenPalette} title="Command palette">
        <kbd>⌘P</kbd>
      </button>
    </footer>
  )
}
