/**
 * One bot's life, frame by frame: springs, the behaviour scheduler, app states,
 * blinks and saccades. Pure - no DOM, no clock, no Math.random. The component
 * feeds it the time and where the cursor is; it answers with a Frame to draw.
 *
 * Everything moves through springs. A behaviour or an app state only sets
 * targets, so changing either never makes the face jump.
 */

import {
  BEHAVIOURS,
  GAZE_PX,
  WATCH_MS,
  behaviourMs,
  faceFor,
  isNear,
  nextInterest,
  pickBehaviour,
  rnd,
  startsWatching,
  stopsWatching,
  type ActiveBehaviour,
  type BehaviourId,
  type Face,
  type Point,
  type Random,
} from './behaviours'
import { SMALL_PX, clamp, lidPolygon, projectEye } from './face'
import { RECTO, type BotLook, type BotPersonality } from './presets'

export type BotMode = 'auto' | 'forced'
export type BotState = 'idle' | 'listening' | 'thinking' | 'answering' | 'error'

/** How long an error keeps the bot squinting before it goes back to its own business. */
export const ERROR_MS = 2000
const BLINK_MS = 140
const CLICK_BLINK_MS = 160

class Spring {
  value: number
  target: number
  velocity = 0
  constructor(
    value: number,
    readonly k: number,
    readonly c: number,
  ) {
    this.value = value
    this.target = value
  }
  step(dt: number): void {
    this.velocity += (-this.k * (this.value - this.target) - this.c * this.velocity) * dt
    this.value += this.velocity * dt
  }
}

const springs = () => ({
  ry: new Spring(0, 60, 10),
  rx: new Spring(0, 60, 10),
  hop: new Spring(0, 240, 16),
  squash: new Spring(1, 300, 15),
  gx: new Spring(0, 420, 30),
  gy: new Spring(0, 420, 30),
  upper: new Spring(0, 160, 18),
  lower: new Spring(0, 160, 18),
  slant: new Spring(0, 120, 14),
  wide: new Spring(1, 200, 16),
})

/** What the bot sees this frame. Distances are px from the bot's centre. */
export type BotInput = {
  /** The cursor, or null when there is none to see. */
  pointer: { dx: number; dy: number; moving: boolean } | null
  /** What listening looks at: the field being typed in. */
  focus: { dx: number; dy: number } | null
}

export type EyeFrame = { rect: { x: number; y: number; width: number; height: number; rx: number }; clip: string }

export type Frame = {
  /** px, ≤ 0: up. */
  hop: number
  rotateX: number
  rotateY: number
  scaleX: number
  scaleY: number
  eyes: [EyeFrame, EyeFrame]
}

export type BotOptions = {
  size: number
  look?: BotLook
  personality?: BotPersonality
  mode: BotMode
  /** The behaviour a forced bot loops. */
  behaviour?: BehaviourId
  reducedMotion: boolean
  random: Random
  /** Milliseconds, the same clock `step` is given. */
  now: number
  /** False holds blinks off (stills). */
  blinks?: boolean
  onBehaviour?: (behaviour: ActiveBehaviour) => void
}

export type Bot = {
  step: (now: number, input: BotInput) => Frame
  setState: (state: BotState, now: number) => void
  click: (now: number) => void
  readonly behaviour: ActiveBehaviour
}

const NO_INPUT: BotInput = { pointer: null, focus: null }

export function createBot(options: BotOptions): Bot {
  const { size, mode, random, reducedMotion } = options
  const look = options.look ?? RECTO.look
  const personality = options.personality ?? RECTO.personality
  const forced = mode === 'forced'
  const small = size < SMALL_PX
  const S = springs()

  let last = options.now
  let behaviour: ActiveBehaviour = 'glance'
  let behaviourStart = options.now
  let behaviourEnd = options.now
  let memo: Record<string, unknown> = {}
  let interest = 0
  let nextSaccade = 0
  let blinkAt = -Infinity
  let nextBlink = options.now + rnd(random, 1500, 3500)
  let clickAt = -Infinity
  let state: BotState = 'idle'
  let stateAt = options.now
  let stateMemo: Record<string, unknown> = {}

  const begin = (next: ActiveBehaviour, now: number, ms: number): void => {
    behaviour = next
    behaviourStart = now
    behaviourEnd = now + ms
    memo = {}
    options.onBehaviour?.(next)
  }
  const choose = (now: number): void => {
    const next = forced ? (options.behaviour ?? 'glance') : pickBehaviour(random, personality.weights)
    begin(next, now, behaviourMs(next, random, !forced, personality.durations))
  }
  choose(options.now)

  /** The face an app state asks for, or null when the personality has the floor. */
  const stateFace = (now: number, t: number, focus: Point, cursor: Point): Face | null => {
    const pt = (now - stateAt) / 1000
    const context = { pt, t, cursor, forced: false, memo: stateMemo, random }
    switch (state) {
      case 'listening':
        return { ...faceFor('watch', { ...context, cursor: focus }), upper: 0.1 }
      case 'thinking':
        return { ...faceFor('daydream', context), upper: 0.25 }
      case 'answering':
        return faceFor('scan', context)
      case 'error':
        return now - stateAt < ERROR_MS ? faceFor('squint', context) : null
      default:
        return null
    }
  }

  const step = (now: number, input: BotInput = NO_INPUT): Frame => {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000))
    last = now
    const t = now / 1000
    const pointer = input.pointer
    const distance = pointer === null ? Infinity : Math.hypot(pointer.dx, pointer.dy)
    const near = isNear(distance, size)
    const movingNearby = pointer !== null && pointer.moving && near
    const towards = (p: { dx: number; dy: number } | null): Point =>
      p === null ? { x: 0, y: 0 } : { x: clamp(p.dx / GAZE_PX, -1, 1), y: clamp(p.dy / GAZE_PX, -1, 1) }
    const cursor = towards(pointer)

    let face: Face
    if (reducedMotion) {
      face = { target: { x: 0, y: 0 }, upper: 0, lower: 0, slant: 0, wide: 1, squash: 1, hop: false }
    } else {
      const fromState = forced ? null : stateFace(now, t, towards(input.focus), cursor)
      if (!forced) {
        interest = nextInterest(interest, dt, movingNearby, personality.curiosity)
        if (fromState === null && behaviour !== 'curious' && behaviour !== 'watch' && startsWatching(interest, movingNearby, dt, random))
          begin('watch', now, rnd(random, WATCH_MS[0], WATCH_MS[1]))
      }
      if (now > behaviourEnd || (behaviour === 'watch' && stopsWatching(near, interest))) choose(now)
      // An app state overrides the personality, but a click still gets its look of surprise.
      face =
        fromState !== null && behaviour !== 'curious'
          ? fromState
          : faceFor(behaviour, { pt: (now - behaviourStart) / 1000, t, cursor, forced, memo, random })
      if (face.hop) S.hop.velocity -= 45
    }

    // Saccades: the gaze jumps to its target every so often, never glides there.
    const { target } = face
    if (!reducedMotion && (now > nextSaccade || Math.hypot(target.x - S.gx.target, target.y - S.gy.target) > 0.35)) {
      S.gx.target = target.x + rnd(random, -0.05, 0.05)
      S.gy.target = target.y + rnd(random, -0.04, 0.04)
      nextSaccade = now + rnd(random, personality.saccade[0], personality.saccade[1])
    }
    S.ry.target = reducedMotion ? 0 : S.gx.value * 5
    S.rx.target = reducedMotion ? 0 : -S.gy.value * 3.5
    S.upper.target = face.upper
    S.lower.target = face.lower
    S.slant.target = face.slant
    S.wide.target = face.wide
    S.squash.target = face.squash
    S.hop.target = 0
    for (const spring of Object.values(S)) spring.step(dt)

    if (options.blinks !== false && now > nextBlink) {
      blinkAt = now
      nextBlink = now + (random() < 0.22 ? 230 : rnd(random, personality.blinkEvery[0], personality.blinkEvery[1]))
    }
    const sinceBlink = (now - blinkAt) / BLINK_MS
    const blink = now - clickAt < CLICK_BLINK_MS ? 1 : sinceBlink >= 0 && sinceBlink < 1 ? Math.sin(sinceBlink * Math.PI) : 0

    const breath = reducedMotion ? 1 : 1 + Math.sin(t * 2) * 0.01
    const squash = S.squash.value * breath
    const lids = { upper: S.upper.value, lower: S.lower.value, slant: S.slant.value }
    const eye = (side: -1 | 1): EyeFrame => {
      const shape = projectEye({ side, gx: S.gx.value, gy: S.gy.value, wide: S.wide.value, blink, small, eyes: look.eyes })
      return { rect: shape.rect, clip: lidPolygon(shape, side, lids) }
    }
    return {
      hop: (Math.min(0, S.hop.value) * size) / 120,
      rotateX: S.rx.value,
      rotateY: S.ry.value,
      scaleX: 2 - squash,
      scaleY: squash,
      eyes: [eye(-1), eye(1)],
    }
  }

  return {
    step,
    setState(next, now) {
      if (next === state) return
      state = next
      stateAt = now
      stateMemo = {}
    },
    click(now) {
      clickAt = now
      if (reducedMotion) return
      interest = 1
      if (!forced) begin('curious', now, BEHAVIOURS.curious.ms)
      S.squash.value = 0.86
      S.hop.velocity -= 50
    },
    get behaviour() {
      return behaviour
    },
  }
}

/**
 * A still: a forced behaviour (or the resting face) simulated from a standing
 * start to `ms`, at a fixed 60 fps, with blinks held off. For snapshots and
 * anywhere a pose must come out the same every time.
 */
export function stillFrame({
  behaviour,
  ms,
  size,
  random,
  look,
}: {
  behaviour: BehaviourId | 'rest'
  ms: number
  size: number
  random: Random
  look?: BotLook
}): Frame {
  const rest = behaviour === 'rest'
  const bot = createBot({
    size,
    ...(look === undefined ? {} : { look }),
    mode: 'forced',
    ...(rest ? {} : { behaviour }),
    reducedMotion: rest,
    random,
    now: 0,
    blinks: false,
  })
  let frame = bot.step(0, NO_INPUT)
  for (let now = 1000 / 60; now <= ms; now += 1000 / 60) frame = bot.step(now, NO_INPUT)
  return frame
}
