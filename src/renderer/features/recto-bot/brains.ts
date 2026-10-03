import type { BotInput, BotState, Pose, Bot } from './bot'

/**
 * One brain per bot. Every face of a bot on screen - its sidebar row, the
 * chat header, the face beside a message - is the same animal: one set of
 * springs, blinks, saccades and app states, stepped once a frame, and each
 * face draws that pose at its own size. A face that appears mid-animation
 * joins the pose as it is; a face that goes doesn't stop the others.
 *
 * Pure (no DOM): the component (RectoBot) wires it to the frame loop.
 */

/** Which app state shows when faces ask for different ones: the most active wins. */
const PRIORITY: Record<BotState, number> = { idle: 0, thinking: 1, listening: 2, riffle: 4, found: 5, answering: 4, error: 3 }

export type Brain = {
  readonly key: string
  readonly bot: Bot
  /** The pose at `now`, stepped once however many faces ask in that frame. */
  poseAt: (now: number, input: BotInput) => Pose
  /** The last pose stepped, for a face that has just appeared. */
  readonly last: Pose | null
  /** A face's wish for the app state; the bot shows the most active one any face asks for. */
  request: (face: number, state: BotState, now: number) => void
  readonly state: BotState
}

type Entry = Brain & { faces: Set<number>; requests: Map<number, BotState>; settle: (now: number) => void }

const brains = new Map<string, Entry>()
let nextFace = 1

/**
 * The brain for `key`, made with `make` if it has none yet, and a handle for
 * one face of it. `release` when the face goes; the last face out ends it.
 */
export function acquire(key: string, make: () => Bot): { brain: Brain; face: number; release: () => void } {
  let entry = brains.get(key)
  if (entry === undefined) {
    const bot = make()
    let last: Pose | null = null
    let lastNow = -1
    let shown: BotState = 'idle'
    const requests = new Map<number, BotState>()
    const created: Entry = {
      key,
      bot,
      faces: new Set(),
      requests,
      poseAt(now, input) {
        if (now !== lastNow || last === null) {
          last = bot.pose(now, input)
          lastNow = now
        }
        return last
      },
      get last() {
        return last
      },
      request(face, state, now) {
        requests.set(face, state)
        created.settle(now)
      },
      settle(now) {
        let best: BotState = 'idle'
        for (const s of requests.values()) if (PRIORITY[s] > PRIORITY[best]) best = s
        if (best !== shown) {
          shown = best
          bot.setState(best, now)
        }
      },
      get state() {
        return shown
      },
    }
    entry = created
    brains.set(key, entry)
  }
  const face = nextFace++
  const held = entry
  held.faces.add(face)
  return {
    brain: held,
    face,
    release: () => {
      held.faces.delete(face)
      held.requests.delete(face)
      if (held.faces.size === 0) brains.delete(key)
      else held.settle(performance.now())
    },
  }
}

/** The pose a bot's faces are showing now, if it has any on screen: a face that appears starts from it. */
export function currentPose(key: string): Pose | null {
  return brains.get(key)?.last ?? null
}

/** For tests: forget every brain. */
export function resetBrains(): void {
  brains.clear()
}
