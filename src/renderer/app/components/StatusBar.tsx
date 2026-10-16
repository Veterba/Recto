import { commands } from '../commands'
import { viewTitle } from '../view-registry'
import type { Workspace } from '../workspace'
import { TopicsNotice } from '../../features/topics'
import { OutsideLinksNotice } from '../../features/file-tree'
import { PeriodicNotice } from '../../features/templates'
import { WritingButtons } from '../../features/editor'
import { Icon } from '../../ui/Icon'
import { Tip } from '../../ui/Tip'

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
  onOpenDaily: () => void
  onOpenPalette: () => void
}

export function StatusBar({ workspace, vaultName, graphOpen, onToggleGraph, onOpenDaily, onOpenPalette }: Props): React.ReactElement {
  const leaf = workspace?.activeLeaf ?? null
  const openCount = workspace?.leaves().length ?? 0

  return (
    <footer className="status">
      <span className="status__item status__item--vault">{vaultName}</span>
      <span className="status__sep" />
      <span className="status__item">{leaf ? viewTitle(leaf.type, leaf.state) : 'Nothing open'}</span>
      <span className="status__spacer" />
      <OutsideLinksNotice />
      <PeriodicNotice />
      {/* Focus mode and the writing tools live here, not in the note's
          toolbar, so they are there even with the toolbar hidden. */}
      <WritingButtons buttonClass="status__btn" iconSize={13} menuPlacement="above" />
      <TopicsNotice />
      <Tip label="Today's note" hint={commands.label('daily:open') ?? undefined} placement="top">
        <button className="status__btn" onClick={onOpenDaily} aria-label="Today's note">
          <Icon name="calendar-days" size={13} />
        </button>
      </Tip>
      <span className="status__item status__item--muted">
        {openCount} {openCount === 1 ? 'tab' : 'tabs'}
      </span>
      <Tip label={graphOpen ? 'Hide graph' : 'Show graph'} hint={commands.label('graph:toggle') ?? undefined} placement="top">
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
