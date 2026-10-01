import { describe, expect, it } from 'vitest'
import { MIN_STRIP, lidPolygon, projectEye } from '../../../../src/renderer/features/recto-bot/face'
import {
  BEHAVIOURS,
  behaviourMs,
  nextInterest,
  pickBehaviour,
  seededRandom,
  startsWatching,
  type BehaviourId,
} from '../../../../src/renderer/features/recto-bot/behaviours'
import { ERROR_MS, createBot, stillFrame } from '../../../../src/renderer/features/recto-bot/bot'
import { CALM, RECTO, RESTLESS } from '../../../../src/renderer/features/recto-bot/presets'

const WEIGHTS = RECTO.personality.weights

const eye = (over: Partial<Parameters<typeof projectEye>[0]> = {}) =>
  projectEye({ side: 1, gx: 0, gy: 0, wide: 1, blink: 0, small: false, eyes: RECTO.look.eyes, ...over })

/** The polygon's points as numbers: [x0, yTopLeft, x1, yTopRight, x1, yBottom, x0, yBottom]. */
const points = (s: string): number[] => s.split(/[ ,]/).map(Number)

describe('eye projection', () => {
  it('rests at ±8.4, -8 with the base size', () => {
    expect(eye().cx).toBeCloseTo(8.4)
    expect(eye({ side: -1 }).cx).toBeCloseTo(-8.4)
    expect(eye().cy).toBeCloseTo(-8)
    expect(eye().width).toBeCloseTo(5 * Math.cos(Math.asin(8.4 / 17)))
    expect(eye().height).toBeCloseTo(12)
  })

  it('small bots get bigger eyes', () => {
    expect(eye({ small: true }).height).toBeCloseTo(13.5)
    expect(eye({ small: true }).width / eye().width).toBeCloseTo(6.6 / 5)
  })

  it('never slides past the page edge, however far it looks', () => {
    for (const gx of [-3, -1, 1, 3]) {
      expect(Math.abs(eye({ gx }).cx)).toBeLessThanOrEqual(16.5)
      expect(Math.abs(eye({ side: -1, gx }).cx)).toBeLessThanOrEqual(16.5)
    }
  })

  it('foreshortens toward the rim, but never below its floor', () => {
    // Looking right, the right eye turns away and narrows; the left one turns to face us.
    expect(eye({ gx: 1 }).width).toBeLessThan(eye().width)
    expect(eye({ side: -1, gx: 1 }).width).toBeGreaterThan(eye({ side: -1 }).width)
    expect(eye({ gx: 5 }).width).toBeCloseTo(5 * 0.58)
    expect(eye({ gy: 1 }).height).toBeLessThan(12)
    expect(eye({ gy: 9 }).height).toBeGreaterThanOrEqual(12 * 0.6 - 1e-9)
  })

  it('a blink squeezes the capsule, wide stretches it', () => {
    expect(eye({ blink: 1 }).rect.height).toBeCloseTo(12 * 0.15)
    expect(eye({ blink: 1 }).height).toBeCloseTo(12)
    expect(eye({ wide: 1.22 }).height).toBeCloseTo(12 * 1.22)
    expect(eye({ wide: 1.22 }).width / eye().width).toBeCloseTo(0.4 + 0.6 * 1.22)
    expect(eye().rect.rx).toBeCloseTo(eye().width / 2)
  })
})

describe('lid polygon', () => {
  const open = { upper: 0, lower: 0, slant: 0 }

  it('open lids clip nothing of the eye', () => {
    const e = eye()
    const p = points(lidPolygon(e, 1, open))
    expect(p[1]).toBeCloseTo(e.cy - 6)
    expect(p[5]).toBeCloseTo(e.cy + 6)
  })

  it('closed is a strip of MIN_STRIP, never nothing', () => {
    for (const lids of [
      { upper: 1, lower: 0, slant: 0 },
      { upper: 1, lower: 1, slant: 0 },
      { upper: 0.9, lower: 0.9, slant: 0 },
    ]) {
      const p = points(lidPolygon(eye(), 1, lids))
      expect(p[5]! - p[1]!).toBeCloseTo(MIN_STRIP)
    }
    // On a squeezed (small) eye too.
    const p = points(lidPolygon(eye({ gy: 5 }), 1, { upper: 1, lower: 1, slant: 0 }))
    expect(p[5]! - p[1]!).toBeCloseTo(MIN_STRIP)
  })

  it('the lower lid rises at most 0.6 of the eye', () => {
    const e = eye()
    expect(points(lidPolygon(e, 1, { upper: 0, lower: 1, slant: 0 }))[5]).toBeCloseTo(e.cy + 6 - 12 * 0.6)
  })

  it('slant drops the inner corners, mirrored between the eyes', () => {
    const lids = { upper: 0.4, lower: 0, slant: 1 }
    const right = points(lidPolygon(eye(), 1, lids))
    const left = points(lidPolygon(eye({ side: -1 }), -1, lids))
    // Right eye: its inner (left) end is lower (larger y) than its outer end.
    expect(right[1]!).toBeGreaterThan(right[3]!)
    // Left eye: its inner (right) end is lower.
    expect(left[3]!).toBeGreaterThan(left[1]!)
    expect(right[1]! - right[3]!).toBeCloseTo(2 * 12 * Math.tan((14 * Math.PI) / 180))
  })
})

describe('behaviour scheduler', () => {
  it('picks by weight', () => {
    const random = seededRandom(42)
    const counts: Record<string, number> = {}
    const n = 40_000
    for (let i = 0; i < n; i++) {
      const id = pickBehaviour(random, WEIGHTS)
      counts[id] = (counts[id] ?? 0) + 1
    }
    const total = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0)
    for (const [id, w] of Object.entries(WEIGHTS)) expect((counts[id] ?? 0) / n).toBeCloseTo(w / total, 2)
    expect(counts['curious']).toBeUndefined()
  })

  it('is repeatable with the same seed', () => {
    const run = (): BehaviourId[] => {
      const random = seededRandom(7)
      return Array.from({ length: 20 }, () => pickBehaviour(random, WEIGHTS))
    }
    expect(run()).toEqual(run())
  })

  it('varies each duration by 0.85-1.2, and not at all when looping one', () => {
    const random = seededRandom(3)
    for (const id of Object.keys(BEHAVIOURS) as BehaviourId[]) {
      for (let i = 0; i < 200; i++) {
        const ms = behaviourMs(id, random)
        expect(ms).toBeGreaterThanOrEqual(BEHAVIOURS[id].ms * 0.85)
        expect(ms).toBeLessThanOrEqual(BEHAVIOURS[id].ms * 1.2)
      }
      expect(behaviourMs(id, random, false)).toBe(BEHAVIOURS[id].ms)
    }
    expect(behaviourMs('doze', random, false, CALM.personality.durations)).toBe(7000)
  })

  it('a forced bot loops its behaviour', () => {
    const seen = new Set<string>()
    const bot = createBot({
      size: 120,
      mode: 'forced',
      behaviour: 'scan',
      reducedMotion: false,
      random: seededRandom(1),
      now: 0,
      onBehaviour: (b) => seen.add(b),
    })
    for (let now = 0; now < 20_000; now += 16) bot.step(now, { pointer: { dx: 10, dy: 10, moving: true }, focus: null })
    expect([...seen]).toEqual(['scan'])
  })
})

describe('interest', () => {
  it('rises while the cursor moves nearby and decays from full to none in about four seconds', () => {
    let interest = 0
    for (let t = 0; t < 1; t += 0.016) interest = nextInterest(interest, 0.016, true)
    expect(interest).toBe(1)
    let seconds = 0
    while (interest > 0) {
      interest = nextInterest(interest, 0.016, false)
      seconds += 0.016
    }
    expect(seconds).toBeGreaterThan(3.9)
    expect(seconds).toBeLessThan(4.1)
  })

  it('curiosity: a curious bot catches on faster and stays interested longer', () => {
    const riseTo = (curiosity: number): number => {
      let interest = 0
      let seconds = 0
      while (interest < 1) {
        interest = nextInterest(interest, 0.016, true, curiosity)
        seconds += 0.016
      }
      return seconds
    }
    const lasts = (curiosity: number): number => {
      let interest = 1
      let seconds = 0
      while (interest > 0) {
        interest = nextInterest(interest, 0.016, false, curiosity)
        seconds += 0.016
      }
      return seconds
    }
    expect(riseTo(0.8)).toBeLessThan(riseTo(0.5))
    expect(riseTo(0.5)).toBeLessThan(riseTo(0.3))
    expect(lasts(0.8)).toBeGreaterThan(lasts(0.5))
    expect(lasts(0.5)).toBeGreaterThan(lasts(0.3))
  })

  it('watching starts only above 0.55 with the cursor moving nearby', () => {
    const always = (): number => 0
    expect(startsWatching(0.5, true, 1 / 60, always)).toBe(false)
    expect(startsWatching(0.9, false, 1 / 60, always)).toBe(false)
    expect(startsWatching(0.9, true, 1 / 60, always)).toBe(true)
  })

  it('an auto bot watches a cursor that keeps moving nearby, and not one far away', () => {
    const run = (dx: number): Set<string> => {
      const seen = new Set<string>()
      const bot = createBot({
        size: 40,
        mode: 'auto',
        reducedMotion: false,
        random: seededRandom(5),
        now: 0,
        onBehaviour: (b) => seen.add(b),
      })
      for (let now = 0; now < 30_000; now += 16) bot.step(now, { pointer: { dx, dy: 0, moving: true }, focus: null })
      return seen
    }
    expect(run(100).has('watch')).toBe(true)
    expect(run(2000).has('watch')).toBe(false)
  })
})

describe('app states', () => {
  const step = (bot: ReturnType<typeof createBot>, from: number, to: number, focus: { dx: number; dy: number } | null = null) => {
    let frame = bot.step(from, { pointer: null, focus })
    for (let now = from; now <= to; now += 16) frame = bot.step(now, { pointer: null, focus })
    return frame
  }

  it('listening looks at the field being typed in', () => {
    const bot = createBot({ size: 32, mode: 'auto', reducedMotion: false, random: seededRandom(2), now: 0 })
    bot.setState('listening', 0)
    const frame = step(bot, 0, 1500, { dx: 400, dy: 300 })
    // Right and down: both eyes right of their rest, and below it.
    expect(frame.eyes[1].rect.x + frame.eyes[1].rect.width / 2).toBeGreaterThan(8.4)
    expect(frame.eyes[1].rect.y + frame.eyes[1].rect.height / 2).toBeGreaterThan(-8)
  })

  it('error squints, then goes back to its own business', () => {
    const bot = createBot({ size: 120, mode: 'auto', reducedMotion: false, random: seededRandom(4), now: 0 })
    const before = bot.behaviour
    bot.setState('error', 0)
    const squinting = step(bot, 0, 1000)
    // The lower lid only rises when squinting.
    const bottom = (f: typeof squinting): number => points(f.eyes[0].clip)[5]!
    const rect = squinting.eyes[0].rect
    expect(bottom(squinting)).toBeLessThan(rect.y + rect.height - 1)
    const after = step(bot, 1000, ERROR_MS + 1500)
    const r = after.eyes[0].rect
    expect(bottom(after)).toBeCloseTo(r.y + r.height, 0)
    expect(before).toBeDefined()
  })

  it('reduced motion holds the eyes still: no rotation, no hop, no saccades', () => {
    const bot = createBot({ size: 120, mode: 'auto', reducedMotion: true, random: seededRandom(9), now: 0 })
    bot.click(0)
    const frames = []
    for (let now = 0; now < 10_000; now += 16) frames.push(bot.step(now, { pointer: { dx: 50, dy: 50, moving: true }, focus: null }))
    for (const f of frames) {
      expect(f.rotateX).toBe(0)
      expect(f.rotateY).toBe(0)
      expect(f.hop).toBe(0)
      expect(f.eyes[1].rect.x + f.eyes[1].rect.width / 2).toBeCloseTo(8.4)
    }
    // Blinks still happen.
    expect(frames.some((f) => f.eyes[0].rect.height < 6)).toBe(true)
  })
})

describe('stills', () => {
  it('the same pose every time', () => {
    const a = stillFrame({ behaviour: 'doze', ms: 3400, size: 120, random: seededRandom(7) })
    const b = stillFrame({ behaviour: 'doze', ms: 3400, size: 120, random: seededRandom(7) })
    expect(a).toEqual(b)
  })

  it('doze at 3.4s has its eyes closed to the minimum strip', () => {
    const f = stillFrame({ behaviour: 'doze', ms: 3400, size: 120, random: seededRandom(7) })
    const p = points(f.eyes[0].clip)
    expect(p[5]! - p[1]!).toBeLessThan(MIN_STRIP + 0.3)
  })
})

describe('presets', () => {
  /** What a bot does over a long stretch with no one around: its behaviours, and how often its gaze jumps. */
  const life = (preset: typeof RECTO): { picks: Record<string, number>; jumpsPerSecond: number } => {
    const picks: Record<string, number> = {}
    const bot = createBot({
      size: 120,
      mode: 'auto',
      look: preset.look,
      personality: preset.personality,
      reducedMotion: false,
      random: seededRandom(11),
      now: 0,
      onBehaviour: (b) => (picks[b] = (picks[b] ?? 0) + 1),
    })
    // Saccade jumps, seen as frames where the gaze target moved: count direction changes of the eyes.
    let jumps = 0
    let last = 0
    let lastVelocity = 0
    const seconds = 600
    for (let now = 0; now < seconds * 1000; now += 16) {
      const x = bot.step(now, { pointer: null, focus: null }).eyes[1].rect.x
      const velocity = x - last
      if (Math.sign(velocity) !== Math.sign(lastVelocity) && Math.abs(velocity) > 0.01) jumps++
      last = x
      lastVelocity = velocity
    }
    return { picks, jumpsPerSecond: jumps / seconds }
  }

  it('the calm bot dozes and daydreams more and moves its eyes less than the restless one', () => {
    const calm = life(CALM)
    const restless = life(RESTLESS)
    expect(calm.picks['doze'] ?? 0).toBeGreaterThan(5 * (restless.picks['doze'] ?? 0))
    expect(calm.picks['daydream'] ?? 0).toBeGreaterThan(restless.picks['daydream'] ?? 0)
    expect(restless.picks['glance'] ?? 0).toBeGreaterThan(3 * (calm.picks['glance'] ?? 0))
    expect(restless.jumpsPerSecond).toBeGreaterThan(calm.jumpsPerSecond * 1.3)
  })

  it('each preset has its own face', () => {
    const at = (p: typeof RECTO): number => projectEye({ side: 1, gx: 0, gy: 0, wide: 1, blink: 0, small: false, eyes: p.look.eyes }).cx
    expect(new Set([at(RECTO), at(CALM), at(RESTLESS)]).size).toBe(3)
  })
})
