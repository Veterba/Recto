import { Icon } from '../../../ui/Icon'
import { showPeriodicNotice, usePeriodicNotice } from '../periodic-notes'

/** A periodic note Recto didn't make, and why, in the status bar until dismissed. */
export function PeriodicNotice(): React.ReactElement | null {
  const notice = usePeriodicNotice()
  if (notice === null) return null
  const { text, action } = notice
  return (
    <span className="status__notice" role="status" title={text}>
      <Icon name="alert-triangle" size={12} />
      <span className="status__notice-text">{text}</span>
      {action !== undefined && (
        <button
          className="status__notice-undo"
          onClick={() => {
            showPeriodicNotice(null)
            action.run()
          }}
        >
          {action.label}
        </button>
      )}
      <button className="status__notice-undo" onClick={() => showPeriodicNotice(null)} aria-label="Dismiss">
        OK
      </button>
    </span>
  )
}
