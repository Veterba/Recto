import type { SettingsDeps } from '../settings-deps'
import { SettingRow } from '../../../ui/SettingRow'
import { Toggle } from '../../../ui/Toggle'
import { Icon } from '../../../ui/Icon'
import { SettingGroup } from './SettingGroup'
import { PREVIEW_DELAY_MIN, PREVIEW_DELAY_MAX } from '../../../app/appearance'

export function AppearanceSettings({ appearance, update }: SettingsDeps): React.ReactElement {
  return (
    <>
      <SettingRow label="Theme" hint="System follows macOS; a choice here overrides it.">
        <div className="segmented segmented--inline">
          {(['system', 'light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              className={`segmented__tab${appearance.theme === theme ? ' is-active' : ''}`}
              onClick={() => update({ theme })}
            >
              <span>{theme}</span>
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label="Translucency"
        hint={
          /Mac OS X/.test(navigator.userAgent)
            ? 'Blur the desktop through the sidebar. How far it goes is set by the theme.'
            : 'macOS only — this platform has no window vibrancy.'
        }
      >
        <Toggle
          on={appearance.translucent}
          onChange={() => update({ translucent: !appearance.translucent })}
          disabled={!/Mac OS X/.test(navigator.userAgent)}
        />
      </SettingRow>

      {appearance.translucent && (
        <p className="setting__note">
          <Icon name="panel-left-close" size={13} />
          How far it goes is the theme's call, not a slider: a dark panel on a light page can be almost entirely backdrop and still read, a
          light panel on a dark one cannot. Full screen switches it off while it lasts — there is no desktop behind a full-screen window,
          only a black space.
        </p>
      )}

      <SettingGroup title="Sidebar">
        <SettingRow
          label="Text size"
          hint={`${Math.round(13 * appearance.sidebarScale)}px file names — the editor's own size is under Editor`}
        >
          <input
            className="slider"
            type="range"
            min={0.9}
            max={1.25}
            step={0.05}
            value={appearance.sidebarScale}
            onChange={(event) => update({ sidebarScale: Number(event.target.value) })}
          />
        </SettingRow>

        <SettingRow label="Note preview delay" hint={`${appearance.previewDelay.toFixed(1)} s resting on a note before its preview opens`}>
          <input
            className="slider"
            type="range"
            min={PREVIEW_DELAY_MIN}
            max={PREVIEW_DELAY_MAX}
            step={0.5}
            value={appearance.previewDelay}
            aria-label="Note preview delay"
            onChange={(event) => update({ previewDelay: Number(event.target.value) })}
          />
        </SettingRow>

        <SettingRow label="Bolder text" hint="A frosted panel eats stroke weight; this puts it back.">
          <Toggle on={appearance.sidebarBold} onChange={() => update({ sidebarBold: !appearance.sidebarBold })} />
        </SettingRow>

        <SettingRow
          label="Brightness"
          hint={
            appearance.sidebarContrast >= 95
              ? 'As white as it goes — over a pale backdrop this starts to glow rather than read'
              : `${appearance.sidebarContrast}% — how white the file names are against the panel`
          }
        >
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={appearance.sidebarContrast}
            onChange={(event) => update({ sidebarContrast: Number(event.target.value) })}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}
