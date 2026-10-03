import { useEffect, useId, useRef, useState } from 'react'
import { createBot, render, stillFrame, type BotMode, type BotState, type EyeFrame, type Frame, type SheetFrame } from '../bot'
import { acquire, currentPose, type Brain } from '../brains'
import type { ActiveBehaviour, BehaviourId } from '../behaviours'
import { CORNER_PATH, LINE_PATHS, PAGE_PATH, SMALL_PX } from '../face'
import { join } from '../loop'
import { RECTO, type BotLook, type BotPersonality } from '../presets'

/**
 * Recto, the bot: a page with eyes.
 *
 * A stack of flat layers - page, text lines, eyes - each pushed toward the
 * viewer by a few px inside a container with perspective, so the slight turn
 * of the page reads as depth. Colours are tokens only: the page is ink, the
 * eyes and lines are what sits on ink, so both themes come for free.
 *
 * React draws the structure once; after that the shared frame loop moves the
 * rig and the eyes directly, never through a render.
 *
 * Faces with the same `id` are one bot (brains.ts): one set of springs,
 * blinks and states, each face drawing the same pose at its own size.
 */

/** Layer depths, in the SVG's 120-unit space (scaled to the bot's size). */
const DEPTH = { sheets: -3, page: 0, lines: 2, eyes: 6 } as const

type Nodes = {
  rig: HTMLDivElement | null
  sheets: (SVGPathElement | null)[]
  balls: (SVGRectElement | null)[]
  clips: (SVGPolygonElement | null)[]
}

const rigTransform = (f: Frame): string =>
  `translateY(${f.hop.toFixed(2)}px) rotateX(${f.rotateX.toFixed(2)}deg) rotateY(${f.rotateY.toFixed(2)}deg) scale(${f.scaleX.toFixed(4)}, ${f.scaleY.toFixed(4)})`

const ballAttrs = (eye: EyeFrame): Record<'x' | 'y' | 'width' | 'height' | 'rx', string> => ({
  x: eye.rect.x.toFixed(2),
  y: eye.rect.y.toFixed(2),
  width: eye.rect.width.toFixed(2),
  height: eye.rect.height.toFixed(2),
  rx: eye.rect.rx.toFixed(2),
})

/**
 * A riffle sheet: the page's shape, a little smaller, turned about the page's
 * bottom centre and lifted as it comes out - so its corners peek out at the
 * sides. At rest it is hidden behind the page.
 */
const sheetTransform = (sheet: SheetFrame): string =>
  `translate(0 ${(-3 * sheet.out).toFixed(2)}) rotate(${(sheet.angle * sheet.out).toFixed(2)} 0 34) scale(0.94)`

function apply(nodes: Nodes, frame: Frame): void {
  if (nodes.rig !== null) nodes.rig.style.transform = rigTransform(frame)
  frame.sheets.forEach((sheet, i) => nodes.sheets[i]?.setAttribute('transform', sheetTransform(sheet)))
  frame.eyes.forEach((eye, i) => {
    const ball = nodes.balls[i]
    if (ball) for (const [name, value] of Object.entries(ballAttrs(eye))) ball.setAttribute(name, value)
    nodes.clips[i]?.setAttribute('points', eye.clip)
  })
}

/** The figure in one pose. Static on its own; RectoBot animates it through `nodes`. */
export function BotFigure({ size, frame, nodes }: { size: number; frame: Frame; nodes?: React.RefObject<Nodes> }): React.ReactElement {
  const id = useId().replace(/[^\w-]/g, '')
  const small = size < SMALL_PX
  const layer = (z: number, children: React.ReactNode): React.ReactElement => (
    <div className="recto-bot__layer" style={{ transform: `translateZ(${((z * size) / 120).toFixed(2)}px)` }}>
      <svg viewBox="-60 -60 120 120" aria-hidden="true">
        {children}
      </svg>
    </div>
  )
  return (
    <div
      className="recto-bot__rig"
      style={{ transform: rigTransform(frame) }}
      ref={(el) => {
        if (nodes) nodes.current.rig = el
      }}
    >
      {layer(
        DEPTH.sheets,
        // The fainter one behind, so the darker one is the nearer sheet.
        [1, 0].map((i) => (
          <path
            key={i}
            className={`recto-bot__sheet recto-bot__sheet--${i === 0 ? 'near' : 'far'}`}
            d={PAGE_PATH}
            transform={sheetTransform(frame.sheets[i]!)}
            ref={(el) => {
              if (nodes) nodes.current.sheets[i] = el
            }}
          />
        )),
      )}
      {layer(
        DEPTH.page,
        <>
          <path className="recto-bot__page" d={PAGE_PATH} />
          <path className="recto-bot__corner" d={CORNER_PATH} />
        </>,
      )}
      {!small &&
        layer(
          DEPTH.lines,
          <g className="recto-bot__lines">
            {LINE_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>,
        )}
      {layer(
        DEPTH.eyes,
        frame.eyes.map((eye, i) => (
          <g key={i}>
            <clipPath id={`${id}-lid${i}`}>
              <polygon
                points={eye.clip}
                ref={(el) => {
                  if (nodes) nodes.current.clips[i] = el
                }}
              />
            </clipPath>
            <rect
              className="recto-bot__eye"
              clipPath={`url(#${id}-lid${i})`}
              {...ballAttrs(eye)}
              ref={(el) => {
                if (nodes) nodes.current.balls[i] = el
              }}
            />
          </g>
        )),
      )}
    </div>
  )
}

export type RectoBotProps = {
  /** px, square. Below 60 the bot is drawn small: no text lines, bigger eyes. */
  size: number
  /**
   * Which bot this is a face of. Every face with the same id moves as one -
   * the same blinks, gaze and working state. Without one, the face is a bot
   * of its own.
   */
  id?: string
  /** Its face, from a preset (presets.ts). Keep the object stable: a new one starts a new bot. */
  look?: BotLook
  /** Its temperament, from a preset. Keep the object stable, as with `look`. */
  personality?: BotPersonality
  /** `auto` lives its own life; `forced` loops `behaviour` (the design page, tests). */
  mode?: BotMode
  behaviour?: BehaviourId
  /** What the app needs it to show. Anything but idle overrides its personality. */
  state?: BotState
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  /** Told each time it starts a behaviour (the design page shows it). */
  onBehaviour?: (behaviour: ActiveBehaviour) => void
  className?: string
}

export function RectoBot({
  id,
  size,
  look = RECTO.look,
  personality = RECTO.personality,
  mode = 'auto',
  behaviour,
  state = 'idle',
  onClick,
  onBehaviour,
  className,
}: RectoBotProps): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null)
  const nodes = useRef<Nodes>({ rig: null, sheets: [], balls: [], clips: [] })
  const brain = useRef<{ brain: Brain; face: number } | null>(null)
  const live = useRef({ state, onBehaviour })
  live.current = { state, onBehaviour }
  const own = useId()
  const key = `${id ?? own}|${mode}|${behaviour ?? ''}`
  // The first paint: what the bot's other faces show right now, or its resting face.
  const [first] = useState(() => {
    const pose = currentPose(key)
    return pose === null ? stillFrame({ behaviour: 'rest', ms: 0, size, random: Math.random, look }) : render(pose, size, look)
  })

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const now = performance.now()
    const handle = acquire(key, () =>
      createBot({
        size,
        look,
        personality,
        mode,
        ...(behaviour === undefined ? {} : { behaviour }),
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        random: Math.random,
        now,
        onBehaviour: (b) => live.current.onBehaviour?.(b),
      }),
    )
    handle.brain.request(handle.face, live.current.state, now)
    brain.current = handle
    const leave = join({
      element,
      group: key,
      size,
      wantsFocus: () => handle.brain.state === 'listening',
      draw: (time, seen) => apply(nodes.current, render(handle.brain.poseAt(time, seen), size, look)),
    })
    return () => {
      leave()
      handle.release()
      brain.current = null
    }
  }, [key, size, look, personality, mode, behaviour])

  useEffect(() => {
    const handle = brain.current
    handle?.brain.request(handle.face, state, performance.now())
  }, [state])

  return (
    <div
      ref={host}
      className={`recto-bot${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Recto"
      data-state={state}
      onClick={(event) => {
        brain.current?.brain.bot.click(performance.now())
        onClick?.(event)
      }}
    >
      <BotFigure size={size} frame={first} nodes={nodes} />
    </div>
  )
}
