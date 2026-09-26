import { Toggle } from '../../../ui/Toggle'

export function GraphSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }): React.ReactElement {
  return (
    <div className="gset__row">
      <span className="gset__label">{label}</span>
      <Toggle on={on} onChange={() => onChange(!on)} label={label} small />
    </div>
  )
}
