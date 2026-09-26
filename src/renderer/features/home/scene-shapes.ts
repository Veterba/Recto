/**
 * The depth shapes: how one is born, grows, lives and recedes.
 */

import { SPREAD } from './scene-tuning'

/**
 * Mulberry32: one multiply-xorshift, seeded per session.
 *
 * Seeded rather than `Math.random` so a session can be replayed - the shapes
 * are the slowest thing on the screen to judge, and judging them twice needs
 * them to be the same twice.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One soft anisotropic gaussian in the depth field.
 *
 * Sizes in height units. Amplitude and sigma grow from nothing together, live,
 * and recede together: a gaussian stays round and soft at every size, so
 * growing from zero is fine here. Amplitude scales with size, so big shapes
 * run deep and small ones stay shallow - and grey.
 */
export type Shape = {
  x: number
  y: number
  sigma: number
  aspect: number
  rot: number
  spin: number
  vx: number
  vy: number
  age: number
  grow: number
  life: number
  recede: number
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** 0 at birth, 1 while it lives, 0 again as it goes. */
function growth(shape: Shape): number {
  const { age, grow, life, recede } = shape
  if (age < grow) return smooth(age / grow)
  if (age < grow + life) return 1
  return smooth(1 - (age - grow - life) / recede)
}

export function bornShape(random: () => number, aspect: number, size: 'small' | 'any' | 'large' = 'any'): Shape {
  const speed = random() * 0.01
  const heading = random() * Math.PI * 2
  return {
    x: random() * aspect,
    y: random(),
    sigma: size === 'small' ? 0.1 + random() * 0.15 : size === 'large' ? 0.3 + random() * 0.15 : 0.1 + random() * 0.35,
    aspect: 1 + random() * 0.6,
    rot: random() * Math.PI,
    spin: (random() * 2 - 1) * 0.03,
    // At most 1% of the height a second.
    vx: Math.cos(heading) * speed,
    vy: Math.sin(heading) * speed,
    age: 0,
    grow: 6 + random() * 6,
    life: 10 + random() * 15,
    recede: 6 + random() * 6,
  }
}

/** What the shader draws for a shape right now: its size and its depth. */
export function shapeNow(shape: Shape): { sigma: number; amp: number } {
  const k = growth(shape)
  return { sigma: Math.max(0.005, shape.sigma * SPREAD * k), amp: k * Math.min(1, Math.max(0.35, shape.sigma / 0.35)) }
}

/**
 * How much of the window is past d = 0.3 right now, from the shapes alone.
 *
 * A 24 x 16 grid in JS, once a second, blurred down each column the way
 * the frost smears the real thing - without that the estimate reads the
 * sharp shapes and runs well above what is on screen.
 * Random births alone swing the page between a quarter covered and all of
 * it; the composition wants 40-65% at any moment, so this is what the
 * lifecycle listens to.
 */
export function coverageOf(shapes: readonly Shape[], aspect: number, ahead = 0): number {
  const live = shapes.map((s) => ({ s, now: shapeNow({ ...s, age: s.age + ahead }) }))
  const grid = new Float32Array(24 * 16)
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 24; i++) {
      const px = ((i + 0.5) / 24) * aspect
      const py = (j + 0.5) / 16
      let h = 0
      for (const { s, now } of live) {
        let qx = px - s.x
        let qy = py - s.y
        const c = Math.cos(s.rot)
        const sn = Math.sin(s.rot)
        ;[qx, qy] = [c * qx + sn * qy, (-sn * qx + c * qy) / s.aspect]
        h += now.amp * Math.exp(-(qx * qx + qy * qy) / (2 * now.sigma * now.sigma))
      }
      grid[j * 24 + i] = h
    }
  }
  // The frost: a gaussian of about 0.1 of the height, reaching up.
  let deep = 0
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 16; j++) {
      let sum = 0
      let wsum = 0
      for (let k = -4; k <= 4; k++) {
        const row = Math.min(15, Math.max(0, j - 1 + k))
        const w = Math.exp(-(k * k) / (2 * 1.6 * 1.6))
        sum += grid[row * 24 + i]! * w
        wsum += w
      }
      if (sum / wsum > 0.2229) deep++
    }
  }
  return deep / (24 * 16)
}
