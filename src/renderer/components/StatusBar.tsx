import { formatChord } from '../core/hotkeys'
import { viewTitle } from '../core/view-registry'
import type { Workspace } from '../core/workspace'
import { Icon } from './Icon'
import { Tip } from './Tip'

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
      <Tip label={graphOpen ? 'Hide graph' : 'Show graph'} hint={formatChord('Mod+G')} placement="top">
        <button
          className={`status__btn${graphOpen ? ' is-on' : ''}`}
          onClick={onToggleGraph}
          aria-label="Toggle graph"
          aria-pressed={graphOpen}
        >
          <Icon name="git-fork" size={13} />
        </button>
      </Tip>
      <Tip label="Command palette" hint="Every command in the app" placement="top">
        <button className="status__btn" onClick={onOpenPalette} aria-label="Command palette">
          <kbd>⌘P</kbd>
        </button>
      </Tip>
    </footer>
  )
}
