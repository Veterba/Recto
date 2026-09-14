import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { nodeRadius } from './look'
import { layoutTargets, type GraphLayout, type Targets } from './layout'
import {
  type Sizing,
  type Tunables,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol'

/**
 * Force layout, in a Worker.
 *
 * The simulation runs here and posts positions back as a Float32Array whose
 * buffer is *transferred* - so there is no per-frame serialisation of thousands
 * of objects, and the main thread never blocks on physics. This is the same
 * shape Obsidian uses, and it is the whole reason a graph of a few thousand
 * notes can be dragged smoothly.
 *
 * The worker knows nothing about drawing and nothing about notes. It receives
 * counts and index pairs, and returns coordinates.
 */

type Node = SimulationNodeDatum & { index: number; degree: number }
type Link = SimulationLinkDatum<Node>

/**
 * `self` inside a worker, typed narrowly.
 *
 * The renderer's tsconfig has lib "dom", which types `self` as a Window and
 * rejects the transfer-list overload. Adding lib "webworker" globally would
 * collide with the DOM types every other renderer module needs, so the cast is
 * local to the one file that is not a document.
 */
const ctx = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<WorkerRequest & { positions?: Float32Array }>) => void) | null
}

let simulation: Simulation<Node, Link> | null = null
let nodes: Node[] = []
/** What the current simulation was built from, so a layout change can re-aim it. */
let current: {
  edges: [number, number][]
  tunables: Tunables
  layout: GraphLayout
  groups: number[]
  sizing: Sizing
  targets: Targets | null
} | null = null
/** Reused between ticks; ownership goes to the main thread and comes back. */
let buffer: Float32Array | null = null

function post(): void {
  if (simulation === null) return
  // The main thread still holds the buffer, or it arrived back detached. Skip
  // this tick rather than allocating a replacement: the simulation is about to
  // produce another set of positions anyway, and dropping a frame is invisible
  // where a per-tick allocation is not.
  if (buffer === null || buffer.byteLength === 0) return
  if (buffer.length !== nodes.length * 2) buffer = new Float32Array(nodes.length * 2)

  for (let i = 0; i < nodes.length; i++) {
    buffer[i * 2] = nodes[i]?.x ?? 0
    buffer[i * 2 + 1] = nodes[i]?.y ?? 0
  }

  const outgoing = buffer
  buffer = null
  const response: WorkerResponse = { kind: 'positions', positions: outgoing, alpha: simulation.alpha() }
  ctx.postMessage(response, [outgoing.buffer])
}


/** The golden angle: successive points never line up, so no rings or spokes form. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * How a node pushes.
 *
 * The layout Obsidian's graph is recognisable for is mostly this one idea:
 * a note with many links needs room for all of them, and a note with none needs
 * almost none. Every node used to push with the same force, so 400 unlinked
 * notes spread as far as the hubs did and settled into concentric rings that
 * filled the canvas - the structure was there, buried in dots.
 */
function charge(node: Node, repel: number): number {
  if (node.degree === 0) return -repel * 0.22
  return -repel * (0.7 + Math.min(2.5, Math.sqrt(node.degree) * 0.45))
}

/**
 * How long a link wants to be.
 *
 * A leaf - a note linked only to its hub - sits close, so a hub reads as one
 * star rather than a loose scatter; links between two well-connected notes get
 * the full length, so separate clusters stay visibly separate.
 */
function linkLength(link: Link, base: number): number {
  const a = (link.source as Node).degree
  const b = (link.target as Node).degree
  return Math.min(a, b) <= 1 ? base * 0.6 : base * (0.9 + Math.min(0.8, Math.log2(a + b) * 0.12))
}

function build(
  count: number,
  edges: [number, number][],
  tunables: Tunables,
  layout: GraphLayout,
  groups: number[],
  sizing: Sizing,
  seed?: Float32Array,
): void {
  simulation?.stop()

  const degree = new Array<number>(count).fill(0)
  for (const [a, b] of edges) {
    if (a < count && b < count) {
      degree[a]!++
      degree[b]!++
    }
  }

  // Seed on a sunflower spiral, not a circle. Every node on one circle, pushed
  // apart evenly, is exactly how rings are made; a golden-angle spiral packs a
  // disc with no two nodes lined up, so there is nothing for rings to form from.
  let carried = 0
  nodes = Array.from({ length: count }, (_, index) => {
    const d = degree[index] ?? 0
    const sx = seed?.[index * 2]
    const sy = seed?.[index * 2 + 1]
    if (sx !== undefined && sy !== undefined && Number.isFinite(sx) && Number.isFinite(sy)) {
      carried++
      return { index, degree: d, x: sx, y: sy }
    }
    const radius = 12 * Math.sqrt(index + 0.5)
    return { index, degree: d, x: Math.cos(index * GOLDEN) * radius, y: Math.sin(index * GOLDEN) * radius }
  })

  // The one allocation this simulation makes. It ping-pongs to the main thread
  // and back for the rest of its life.
  buffer = new Float32Array(count * 2)

  const valid = edges.filter(([a, b]) => a < count && b < count)
  const links: Link[] = valid.map(([a, b]) => ({ source: nodes[a]!, target: nodes[b]! }))

  current = { edges: valid, tunables, layout, groups, sizing, targets: null }

  simulation = forceSimulation(nodes)
    .force('link', forceLink<Node, Link>(links))
    // Nodes never overlap: a dot that sits on another is a dot you cannot see
    // or click, and piles of them are most of what made the graph look messy.
    .force('center', forceCenter(0, 0).strength(1))
    .velocityDecay(0.35)
    .alphaDecay(0.025)
    .on('tick', post)
    .on('end', () => {
      const response: WorkerResponse = { kind: 'settled' }
      ctx.postMessage(response)
    })

  configure()
  // A mostly-carried layout is already near its answer; starting it at full
  // heat would shake a settled graph apart to arrive back where it was.
  simulation.alpha(count > 0 && carried / count > 0.5 ? 0.35 : 1)
}

/**
 * (Re)apply every force from the current tunables, layout and sizing.
 *
 * One function for build and for every later change, so a slider moved while
 * a tree layout is showing cannot quietly put back the organic forces.
 */
function configure(): void {
  if (simulation === null || current === null) return
  const { tunables, layout, groups, sizing, edges } = current
  const targets = layoutTargets(nodes.length, edges, layout, groups, tunables.linkDistance, (i) =>
    nodeRadius(nodes[i]?.degree ?? 0, sizing.size, sizing.growth),
  )
  current.targets = targets
  const structured = targets !== null

  // Barnes-Hut approximation over a quadtree - this is what makes it O(n log n).
  // A shorter reach keeps clusters from shoving each other to the edges.
  simulation.force(
    'charge',
    forceManyBody<Node>()
      .strength((node) => charge(node, tunables.repelStrength) * (targets?.charge ?? 1))
      .distanceMax(420),
  )

  const link = simulation.force('link') as ReturnType<typeof forceLink<Node, Link>> | undefined
  const cross = targets?.crossGroupLinks ?? 1
  link
    ?.distance((l) => linkLength(l, tunables.linkDistance))
    .strength((l) => {
      const same = groups[(l.source as Node).index] === groups[(l.target as Node).index]
      return tunables.linkStrength * (targets?.links ?? 1) * (same ? 1 : cross)
    })

  simulation.force(
    'collide',
    forceCollide<Node>((node) => nodeRadius(node.degree, sizing.size, sizing.growth) + 2.5)
      .strength(0.9)
      .iterations(1),
  )

  // A structured layout has its own centre; the centring force would drag a
  // tree growing downward back up over its own root.
  ;(simulation.force('center') as ReturnType<typeof forceCenter<Node>> | undefined)?.strength(structured ? 0 : 1)

  if (targets === null) {
    // Pull toward the middle: linked groups more firmly, so the structure sits
    // together in the centre, and unlinked notes gently, so they gather around
    // it as a soft cloud instead of flying to the edges.
    const pull = (node: Node): number =>
      node.degree === 0 ? tunables.centerStrength * 1.2 : tunables.centerStrength * 1.6
    simulation.force('x', forceX<Node>(0).strength(pull))
    simulation.force('y', forceY<Node>(0).strength(pull))
    simulation.force('radial', null)
    return
  }

  const has = (values: Float32Array, node: Node): boolean => !Number.isNaN(values[node.index] ?? Number.NaN)
  simulation.force(
    'x',
    forceX<Node>((node) => (has(targets.x, node) ? targets.x[node.index]! : 0)).strength((node) =>
      has(targets.x, node) ? targets.pull : tunables.centerStrength * 0.5,
    ),
  )
  simulation.force(
    'y',
    forceY<Node>((node) => (has(targets.y, node) ? targets.y[node.index]! : 0)).strength((node) =>
      has(targets.y, node) ? targets.pull : tunables.centerStrength * 0.5,
    ),
  )
  const radius = targets.radius
  simulation.force(
    'radial',
    radius === null ? null : forceRadial<Node>((node) => radius[node.index] ?? 0, 0, 0).strength(targets.pull),
  )
}

ctx.onmessage = (event): void => {
  try {
    handle(event)
  } catch (error) {
    // A layout that throws must say so. Swallowed, it left the graph silently
    // in its previous shape, which looks exactly like the button doing nothing.
    const response: WorkerResponse = { kind: 'error', message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) }
    ctx.postMessage(response)
  }
}

function handle(event: MessageEvent<WorkerRequest & { positions?: Float32Array }>): void {
  const message = event.data

  // The main thread returns the buffer it borrowed.
  if (message.positions !== undefined) {
    buffer = message.positions
    return
  }

  switch (message.kind) {
    case 'start':
      build(message.count, message.edges, message.tunables, message.layout, message.groups, message.sizing, message.seed)
      break

    case 'tunables':
      if (simulation === null || current === null) break
      current.tunables = message.tunables
      configure()
      // Never COOLER than it already is: a slider moved while a new layout is
      // still travelling used to drop the heat and freeze it half-way.
      simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart()
      break

    case 'layout':
      if (simulation === null || current === null) break
      current.layout = message.layout
      configure()
      // Hot enough to travel all the way from one shape to the other.
      simulation.alpha(0.9).restart()
      break

    case 'sizing':
      if (simulation === null || current === null) break
      current.sizing = message.sizing
      configure()
      simulation.alpha(Math.max(simulation.alpha(), 0.25)).restart()
      break

    case 'reheat':
      simulation?.alpha(0.6).restart()
      break

    case 'drag': {
      const node = nodes[message.index]
      if (node === undefined) break
      // fx/fy pin the node; d3 then solves the rest around it.
      node.fx = message.x
      node.fy = message.y
      simulation?.alpha(0.3).restart()
      break
    }

    case 'release': {
      const node = nodes[message.index]
      if (node === undefined) break
      delete node.fx
      delete node.fy
      break
    }

    case 'stop':
      simulation?.stop()
      simulation = null
      current = null
      nodes = []
      buffer = null
      break
  }
}
