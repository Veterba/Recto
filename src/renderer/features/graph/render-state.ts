/**
 * What the graph's draw loop reads each frame.
 */

import type { GraphLook } from './look'

export type GraphNodeView = {
  path: string
  label: string
  degree: number
  /** Top-level folder, as an index - for colouring by folder. */
  group?: number
  /** A topic: drawn as a hollow circle, never filled. */
  topic?: boolean
}

export type Camera = { x: number; y: number; zoom: number }

export type RenderState = {
  nodes: readonly GraphNodeView[]
  /** Index pairs into `nodes`. */
  edges: readonly [number, number][]
  positions: Float32Array
  /** Index of the note currently open, or -1. */
  active: number
  /** Indices one hop from the active note. */
  neighbours: ReadonlySet<number>
  hovered: number
  /**
   * The note under the pointer and everything it links to, or null.
   *
   * While it is set, the rest of the graph is veiled: the one question a graph
   * is asked - what is this connected to - is answered by taking everything
   * else away, which is what Obsidian does on hover and while dragging.
   */
  focus?: ReadonlySet<number> | null
  /**
   * How far the veil has come up, 0 to 1.
   *
   * The highlight used to arrive and leave in one frame, which reads as the
   * picture being replaced rather than a layer coming over it. The caller eases
   * this; everything the focus draws is scaled by it, so the veil, the lit
   * edges and their names all arrive together.
   */
  focusFade?: number
  camera: Camera
  showLabels: boolean
  look?: GraphLook
  /** Milliseconds, for anything that moves on its own (pulses). */
  time?: number
  /**
   * In a tree layout: which links are the tree's own, by edge index, and which
   * way it grows. Tree links are drawn as smooth branches; the rest - links
   * that close loops - faintly, or they cross the whole picture and hide it.
   */
  treeEdges?: ReadonlySet<number> | null
  /**
   * Links only the topics property makes, by edge index. Drawn thinner and
   * dashed, so the links the user wrote stay the visible structure.
   */
  autoEdges?: ReadonlySet<number>
  treeDirection?: 'down' | 'up' | 'left' | 'right' | 'out' | null
  /** In the circle layout: bow every link toward the centre, like a chord diagram. */
  bundle?: boolean
}
