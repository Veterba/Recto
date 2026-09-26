import type { SettingsDeps } from '../settings-deps'
import { SettingRow } from '../../../ui/SettingRow'
import { Toggle } from '../../../ui/Toggle'

export function EditorSettings({ appearance, update }: SettingsDeps): React.ReactElement {
  return (
    <>
      <SettingRow label="Live Preview" hint="Hide markdown markers until the cursor reaches the line.">
        <Toggle on={appearance.livePreview} onChange={() => update({ livePreview: !appearance.livePreview })} />
      </SettingRow>

      <SettingRow label="Font" hint="Monospace suits source; serif suits long-form reading.">
        <div className="segmented segmented--inline">
          {(['mono', 'sans', 'serif'] as const).map((font) => (
            <button
              key={font}
              className={`segmented__tab${appearance.editorFont === font ? ' is-active' : ''}`}
              onClick={() => update({ editorFont: font })}
            >
              <span>{font}</span>
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Heading font" hint="Match uses the body font. A serif over a sans reads well.">
        <div className="segmented segmented--inline">
          {(['match', 'mono', 'sans', 'serif'] as const).map((font) => (
            <button
              key={font}
              className={`segmented__tab${appearance.headingFont === font ? ' is-active' : ''}`}
              onClick={() => update({ headingFont: font })}
            >
              <span>{font}</span>
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label="Heading size"
        hint={`${appearance.headingScale.toFixed(2)}× per level — H1 is ${Math.round(
          appearance.fontSize * appearance.headingScale ** 3,
        )}px against ${appearance.fontSize}px body`}
      >
        <input
          className="slider"
          type="range"
          min={1}
          max={1.6}
          step={0.05}
          value={appearance.headingScale}
          onChange={(event) => update({ headingScale: Number(event.target.value) })}
        />
      </SettingRow>

      <SettingRow label="Note name" hint="The note's name, centred above its text. Edit it there to rename the note.">
        <Toggle
          on={appearance.showNoteTitle}
          onChange={() => update({ showNoteTitle: !appearance.showNoteTitle })}
          label="Show note name"
        />
      </SettingRow>

      <SettingRow label="Vim mode" hint="Modal editing. Esc for normal mode, :w saves.">
        <Toggle on={appearance.vimMode} onChange={() => update({ vimMode: !appearance.vimMode })} />
      </SettingRow>

      <SettingRow label="Font size" hint={`${appearance.fontSize}px`}>
        <input
          className="slider"
          type="range"
          min={11}
          max={24}
          step={1}
          value={appearance.fontSize}
          onChange={(event) => update({ fontSize: Number(event.target.value) })}
        />
      </SettingRow>
    </>
  )
}
