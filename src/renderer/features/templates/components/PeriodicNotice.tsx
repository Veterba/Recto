import { Icon } from '../../../ui/Icon'
import { showPeriodicNotice, usePeriodicNotice } from '../periodic-notes'

/** A periodic note Recto didn't make, and why, in the status bar until dismissed. */
export function PeriodicNotice(): React.ReactElement | null {
  const text = usePeriodicNotice()
  if (text === null) return null
  return (
    <span className="status__notice" role="status" title={text}>
      <Icon name="alert-triangle" size={12} />
      <span className="status__notice-text">{text}</span>
      <button className="status__notice-undo" onClick={() => showPeriodicNotice(null)} aria-label="Dismiss">
        OK
      </button>
    </span>
  )
}
