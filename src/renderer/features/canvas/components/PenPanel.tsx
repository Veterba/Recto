import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { HIGHLIGHT_COLORS, PEN_COLORS, PEN_SIZES, setPen, usePen, type PenSize } from '../pen'

/**
 * Over the tool bar while Draw is on: pen or highlighter, its size and its
 * colour - each kept for the next stroke, and for the next time.
 */

const SIZE_DOT: Record<PenSize, number> = { S: 4, M: 7, L: 11, XL: 15 }
const SIZE_NAME: Record<PenSize, string> = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large' }

export function PenPanel(): React.ReactElement {
  const settings = usePen()
  const kind = settings.kind
  const now = settings[kind]
  const colors: readonly (string | null)[] = kind === 'pen' ? PEN_COLORS : HIGHLIGHT_COLORS
  const set = (patch: Partial<{ size: PenSize; color: string | null }>): void =>
    setPen(kind === 'pen' ? { ...settings, pen: { ...settings.pen, ...patch } } : { ...settings, highlighter: { ...settings.highlighter, ...(patch as { size?: PenSize; color?: string }) } })

  return (
    <div className="canvas-pen glass-surface" role="toolbar" aria-label="Pen">
      <Tip label="Pen" placement="top">
        <button className={`canvas-style__button${kind === 'pen' ? ' is-on' : ''}`} aria-label="Pen" aria-pressed={kind === 'pen'} onClick={() => setPen({ ...settings, kind: 'pen' })}>
          <Icon name="pen-line" size={16} />
        </button>
      </Tip>
      <Tip label="Highlighter" hint="Under the ink, see-through" placement="top">
        <button
          className={`canvas-style__button${kind === 'highlighter' ? ' is-on' : ''}`}
          aria-label="Highlighter"
          aria-pressed={kind === 'highlighter'}
          onClick={() => setPen({ ...settings, kind: 'highlighter' })}
        >
          <Icon name="highlighter" size={16} />
        </button>
      </Tip>
      <span className="canvas-style__gap" />
      {PEN_SIZES.map((size) => (
        <button
          key={size}
          className={`canvas-style__button canvas-pen__size${now.size === size ? ' is-on' : ''}`}
          aria-label={SIZE_NAME[size]}
          aria-pressed={now.size === size}
          onClick={() => set({ size })}
        >
          <span style={{ width: SIZE_DOT[size], height: SIZE_DOT[size] }} />
        </button>
      ))}
      <span className="canvas-style__gap" />
      {colors.map((color) => (
        <button
          key={color ?? 'ink'}
          aria-label={color ?? 'Ink'}
          className={`menu__swatch${now.color === color ? ' is-current' : ''}`}
          style={{ '--swatch': color ?? 'var(--text-primary)' } as React.CSSProperties}
          onClick={() => set({ color })}
        />
      ))}
      <label className="canvas-style__custom" aria-label="Any colour">
        <Icon name="palette" size={14} />
        <input type="color" value={now.color !== null && !colors.includes(now.color) ? now.color : '#888888'} onChange={(ev) => set({ color: ev.target.value })} />
      </label>
    </div>
  )
}

/** Over the tool bar while Erase is on: cut what it passes over, or take whole strokes. */
export function EraserPanel(): React.ReactElement {
  const settings = usePen()
  return (
    <div className="canvas-pen glass-surface" role="toolbar" aria-label="Eraser">
      <Tip label="Cut" hint="Takes out only what it passes over" placement="top">
        <button
          className={`canvas-style__button${settings.eraser === 'cut' ? ' is-on' : ''}`}
          aria-label="Cut"
          aria-pressed={settings.eraser === 'cut'}
          onClick={() => setPen({ ...settings, eraser: 'cut' })}
        >
          <Icon name="scissors" size={16} />
        </button>
      </Tip>
      <Tip label="Whole strokes" hint="Takes every stroke it touches" placement="top">
        <button
          className={`canvas-style__button${settings.eraser === 'whole' ? ' is-on' : ''}`}
          aria-label="Whole strokes"
          aria-pressed={settings.eraser === 'whole'}
          onClick={() => setPen({ ...settings, eraser: 'whole' })}
        >
          <Icon name="eraser" size={16} />
        </button>
      </Tip>
    </div>
  )
}
