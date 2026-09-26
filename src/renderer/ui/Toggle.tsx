/** An on/off switch. `small` is the compact size used inside panels and properties. */
export function Toggle({
  on,
  onChange,
  label,
  small,
  disabled,
}: {
  on: boolean
  onChange: () => void
  label?: string
  small?: boolean
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      className={`toggle${small === true ? ' toggle--sm' : ''}${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="toggle__knob" />
    </button>
  )
}
