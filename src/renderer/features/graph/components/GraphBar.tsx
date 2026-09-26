import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'

type Toggle = { on: boolean; set: (on: boolean) => void }

type Props = {
  labels: Toggle
  orphans: Toggle
  localOnly: Toggle
  tasks: Toggle
  chats: Toggle
  hasActive: boolean
  onCentre: () => void
  onFit: () => void
  nodeCount: number
  edgeCount: number
  frameMs: number
  settling: boolean
}

/** The bar along the graph's bottom: what is shown, where the camera goes, and how many. */
export function GraphBar({
  labels,
  orphans,
  localOnly,
  tasks,
  chats,
  hasActive,
  onCentre,
  onFit,
  nodeCount,
  edgeCount,
  frameMs,
  settling,
}: Props): React.ReactElement {
  return (
    <div className="graph__bar">
      <Tip label="Show labels" placement="top">
        <button
          className={`graph__btn${labels.on ? ' is-on' : ''}`}
          onClick={() => labels.set(!labels.on)}
          aria-pressed={labels.on}
          aria-label="Show labels"
        >
          <Icon name="type" size={13} />
        </button>
      </Tip>
      <Tip label="Show unlinked notes" hint="Notes with no links either way" placement="top">
        <button
          className={`graph__btn${orphans.on ? ' is-on' : ''}`}
          onClick={() => orphans.set(!orphans.on)}
          aria-pressed={orphans.on}
          aria-label="Show unlinked notes"
        >
          <Icon name="circle-dashed" size={13} />
        </button>
      </Tip>
      <Tip label="Only this note's links" hint="The open note and what it links to" placement="top">
        <button
          className={`graph__btn${localOnly.on ? ' is-on' : ''}`}
          onClick={() => localOnly.set(!localOnly.on)}
          aria-pressed={localOnly.on}
          aria-label="Only this note's links"
        >
          <Icon name="waypoints" size={13} />
        </button>
      </Tip>
      <Tip label="Show task cards" hint="Hidden with their folder, shown here on request" placement="top">
        <button
          className={`graph__btn${tasks.on ? ' is-on' : ''}`}
          onClick={() => tasks.set(!tasks.on)}
          aria-pressed={tasks.on}
          aria-label="Show task cards"
        >
          <Icon name="square-kanban" size={13} />
        </button>
      </Tip>
      <Tip label="Show AI chats" hint="Conversations with Claude, saved as notes" placement="top">
        <button
          className={`graph__btn${chats.on ? ' is-on' : ''}`}
          onClick={() => chats.set(!chats.on)}
          aria-pressed={chats.on}
          aria-label="Show AI chats"
        >
          <Icon name="message-square" size={13} />
        </button>
      </Tip>
      {/* The one control the graph was missing: pan back to where you are.
          Once you have dragged the view somewhere, the highlight is only
          useful if you can get back to it. */}
      <Tip label="Centre on the open note" hint={hasActive ? undefined : 'No note open'} placement="top">
        <button className="graph__btn" onClick={onCentre} disabled={!hasActive} aria-label="Centre on the open note">
          <Icon name="crosshair" size={13} />
        </button>
      </Tip>
      <Tip label="Fit every note on screen" placement="top">
        <button className="graph__btn" onClick={onFit} aria-label="Fit to view">
          <Icon name="maximize" size={13} />
        </button>
      </Tip>
      <span className="graph__spacer" />
      {/* The frame time is diagnostic, not something to read every day, so it
          lives in the tooltip and in an attribute the probes can measure. */}
      <span className="graph__stat" data-frame-ms={frameMs} title={`${nodeCount} notes, ${edgeCount} links — last frame ${frameMs}ms`}>
        {nodeCount} · {edgeCount}
        {settling ? ' · settling' : ''}
      </span>
    </div>
  )
}
