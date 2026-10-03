/**
 * One requestAnimationFrame loop for every bot on screen.
 *
 * Each frame reads every visible bot's position first and only then lets each
 * one draw, so the writes of one never force a layout for the reads of the
 * next. A bot scrolled or folded out of view is skipped (IntersectionObserver),
 * and the whole loop stops while the window is hidden.
 */

export type Seen = {
  pointer: { dx: number; dy: number; moving: boolean } | null
  focus: { dx: number; dy: number } | null
}

export type Member = {
  element: HTMLElement
  /** Wants the focused element's position this frame (a listening bot). */
  wantsFocus: () => boolean
  draw: (now: number, seen: Seen) => void
  /**
   * Faces of one bot share a group: they all see what its biggest visible face
   * sees, so every face of the bot looks the same way.
   */
  group?: string
  size?: number
}

/** A cursor that has not moved for this long is no longer "moving nearby". */
const MOVING_MS = 1200

const members = new Set<Member>()
const visible = new WeakSet<Element>()
let frame = 0
let observer: IntersectionObserver | null = null
const pointer = { x: 0, y: 0, at: -Infinity, seen: false }

const onPointer = (event: PointerEvent): void => {
  const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y)
  pointer.x = event.clientX
  pointer.y = event.clientY
  pointer.seen = true
  if (moved > 2) pointer.at = performance.now()
}

const onVisibility = (): void => {
  if (document.hidden) stop()
  else start()
}

function tick(now: number): void {
  frame = 0
  const focused = document.activeElement
  const focusRect = focused instanceof HTMLElement && focused !== document.body ? focused.getBoundingClientRect() : null
  const due: { member: Member; seen: Seen }[] = []
  for (const member of members) {
    if (!visible.has(member.element)) continue
    const r = member.element.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    due.push({
      member,
      seen: {
        pointer: pointer.seen ? { dx: pointer.x - cx, dy: pointer.y - cy, moving: now - pointer.at < MOVING_MS } : null,
        focus:
          focusRect !== null && member.wantsFocus()
            ? { dx: focusRect.left + focusRect.width / 2 - cx, dy: focusRect.top + focusRect.height / 2 - cy }
            : null,
      },
    })
  }
  // Each group sees through its biggest visible face.
  const eyes = new Map<string, { size: number; seen: Seen }>()
  for (const { member, seen } of due) {
    if (member.group === undefined) continue
    const current = eyes.get(member.group)
    if (current === undefined || (member.size ?? 0) > current.size) eyes.set(member.group, { size: member.size ?? 0, seen })
  }
  for (const { member, seen } of due) member.draw(now, member.group === undefined ? seen : (eyes.get(member.group)?.seen ?? seen))
  start()
}

/**
 * A debug switch, `localStorage.rectoBotStill = '1'`: no bot moves, each keeps
 * the resting face it was first drawn with. For screenshots that must come out
 * the same every run - even reduced motion still blinks, at random moments.
 */
const still = ((): boolean => {
  try {
    return localStorage.getItem('rectoBotStill') === '1'
  } catch {
    return false
  }
})()

function start(): void {
  if (frame === 0 && members.size > 0 && !document.hidden && !still) frame = requestAnimationFrame(tick)
}

function stop(): void {
  if (frame !== 0) cancelAnimationFrame(frame)
  frame = 0
}

/** Adds a bot to the loop; returns the call that takes it out. */
export function join(member: Member): () => void {
  if (members.size === 0) {
    addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target)
        else visible.delete(entry.target)
      }
    })
  }
  members.add(member)
  observer?.observe(member.element)
  start()
  return () => {
    members.delete(member)
    observer?.unobserve(member.element)
    visible.delete(member.element)
    if (members.size > 0) return
    stop()
    removeEventListener('pointermove', onPointer)
    document.removeEventListener('visibilitychange', onVisibility)
    observer?.disconnect()
    observer = null
  }
}
