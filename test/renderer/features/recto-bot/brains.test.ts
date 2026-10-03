import { beforeEach, describe, expect, it } from 'vitest'
import { createBot, render, type BotState } from '../../../../src/renderer/features/recto-bot/bot'
import { seededRandom } from '../../../../src/renderer/features/recto-bot/behaviours'
import { acquire, currentPose, resetBrains } from '../../../../src/renderer/features/recto-bot/brains'

const NONE = { pointer: null, focus: null }
const make = (seed: number) => () => createBot({ size: 40, mode: 'auto', reducedMotion: false, random: seededRandom(seed), now: 0 })

beforeEach(() => resetBrains())

describe('one brain per bot', () => {
  it('two faces of one bot show the same pose on the same tick, each at its own size', () => {
    const row = acquire('recto|auto|', make(1))
    const header = acquire('recto|auto|', make(99))
    expect(header.brain).toBe(row.brain)
    for (let now = 0; now < 5000; now += 16) {
      const a = row.brain.poseAt(now, NONE)
      const b = header.brain.poseAt(now, NONE)
      expect(b).toBe(a)
    }
    const pose = row.brain.last!
    const small = render(pose, 24)
    const big = render(pose, 64)
    expect(small.rotateY).toBe(big.rotateY)
    expect(small.sheets).toEqual(big.sheets)
  })

  it('a face that appears later starts from the pose the others show', () => {
    const first = acquire('recto|auto|', make(2))
    for (let now = 0; now < 3000; now += 16) first.brain.poseAt(now, NONE)
    const pose = currentPose('recto|auto|')
    const later = acquire('recto|auto|', make(3))
    expect(later.brain.last).toBe(pose)
  })

  it('different bots do not share anything', () => {
    const recto = acquire('recto|auto|', make(4))
    const critic = acquire('critic|auto|', make(5))
    expect(critic.brain).not.toBe(recto.brain)
    recto.brain.request(recto.face, 'riffle', 0)
    expect(critic.brain.state).toBe('idle')
  })

  it('the most active state any face asks for is shown, and goes when that face goes', () => {
    const row = acquire('recto|auto|', make(6))
    const group = acquire('recto|auto|', make(6))
    row.brain.request(row.face, 'idle', 0)
    group.brain.request(group.face, 'riffle', 0)
    expect(row.brain.state).toBe('riffle')
    group.release()
    expect(row.brain.state).toBe('idle')
  })
})

describe('working states loop without a cut', () => {
  /** The largest change in either sheet's visible angle from one frame to the next. */
  function worstJump(script: [number, BotState][], until: number): number {
    const bot = createBot({ size: 40, mode: 'auto', reducedMotion: false, random: seededRandom(11), now: 0 })
    const queue = [...script]
    let previous: number[] | null = null
    let worst = 0
    for (let now = 0; now <= until; now += 1000 / 60) {
      while (queue.length > 0 && queue[0]![0] <= now) bot.setState(queue.shift()![1], now)
      const sheets = bot.pose(now, NONE).sheets.map((s) => s.angle * s.out)
      if (previous !== null) worst = Math.max(worst, ...sheets.map((a, i) => Math.abs(a - previous![i]!)))
      previous = sheets
    }
    return worst
  }

  it('riffling for twelve seconds never jumps', () => {
    expect(worstJump([[0, 'riffle']], 12_000)).toBeLessThan(3)
  })

  it('a state change mid-flick lets the sheets finish and slide back', () => {
    // 1.37 s is in the middle of a cycle (each is 0.9 s ± 15%).
    expect(
      worstJump(
        [
          [0, 'riffle'],
          [1370, 'found'],
          [1770, 'answering'],
          [9000, 'idle'],
        ],
        11_000,
      ),
    ).toBeLessThan(3)
  })

  it('reading while answering sweeps along a line and goes on past it, never restarting', () => {
    const bot = createBot({ size: 40, mode: 'auto', reducedMotion: false, random: seededRandom(12), now: 0 })
    bot.setState('answering', 0)
    let previous = bot.pose(0, NONE).gx
    let worst = 0
    let lefts = 0
    for (let now = 16; now <= 20_000; now += 16) {
      const gx = bot.pose(now, NONE).gx
      worst = Math.max(worst, Math.abs(gx - previous))
      if (gx < -0.4 && previous >= -0.4) lefts++
      previous = gx
    }
    // A new line every 2.4 s: the eyes go back to the left about eight times in 20 s.
    expect(lefts).toBeGreaterThanOrEqual(6)
    // The gaze moves on springs: no single frame teleports it.
    expect(worst).toBeLessThan(0.35)
  })
})
