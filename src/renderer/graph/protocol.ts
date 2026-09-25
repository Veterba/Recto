/**
 * The contract between the graph view and its physics worker.
 *
 * It lives in its own module for a reason that is easy to miss: if the view
 * imported these types from `simulation.worker.ts`, the bundler would pull the
 * worker's module - and therefore d3-force - into the main renderer chunk as
 * well as the worker chunk. Same reasoning as `src/indexer/protocol.ts`.
 */

import type { GraphLayout } from './layout'

export type Tunables = {
  repelStrength: number
  linkDistance: number
  linkStrength: number
  centerStrength: number
  /**
   * How much of the centre pull a note with no links feels.
   *
   * Lower means further out and a wider gap between the linked web and the
   * notes that are not part of it: a note with no links feels nothing but the
   * crowd pushing it outward and this tether holding it in, so loosening the
   * tether moves the whole unlinked population out together.
   */
  orphanPull: number
}

/**
 * Where the organic layout starts, dialled by hand against a 908-note vault.
 *
 * A very long reach with a short spring and a firm pull to the centre: the
 * repulsion spreads the web out, the centre keeps it one object rather than a
 * scatter, and the notes with no links settle into the shells around it. Every
 * Forces slider carries a mark at its value, so however far you wander there is
 * a point to come back to.
 */
export const DEFAULT_TUNABLES: Tunables = {
  repelStrength: 2400,
  linkDistance: 125,
  linkStrength: 0.6,
  centerStrength: 1,
  orphanPull: 0.85,
}

export type WorkerRequest =
  | {
      kind: 'start'
      count: number
      edges: [number, number][]
      /**
       * Indices into `edges` of auto-links: pulled at half strength, so the
       * links the user wrote stay the shape of the graph as auto-links pile up.
       */
      auto?: number[]
      tunables: Tunables
      /**
       * Optional `[x, y]` per node from the previous layout. Nodes that survive
       * a rebuild keep their place instead of being thrown back onto the seed
       * circle - otherwise every save that touches a link re-scatters the
       * entire graph and the picture you had learned is gone.
       */
      seed?: Float32Array
      layout: GraphLayout
      /** Group per node (top-level folder), for the clusters layout. */
      groups: number[]
      /** Node size and growth from the look, so collisions match the drawing. */
      sizing: Sizing
    }
  | { kind: 'tunables'; tunables: Tunables }
  | { kind: 'layout'; layout: GraphLayout }
  | { kind: 'sizing'; sizing: Sizing }
  | { kind: 'reheat' }
  /** A node pinned under the pointer while the user drags it. */
  | { kind: 'drag'; index: number; x: number; y: number }
  | { kind: 'release'; index: number }
  | { kind: 'stop' }

export type Sizing = { size: number; growth: number }

export type WorkerResponse =
  | { kind: 'positions'; positions: Float32Array; alpha: number }
  | { kind: 'settled' }
  /** Something in the worker threw; the view logs it rather than going quiet. */
  | { kind: 'error'; message: string }
