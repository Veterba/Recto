import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import {
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

type Node = SimulationNodeDatum & { index: number }
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

function build(count: number, edges: [number, number][], tunables: Tunables, seed?: Float32Array): void {
  simulation?.stop()

  // Seed on a circle rather than at the origin: identical starting positions
  // make the repulsion force explode symmetrically and the first few frames
  // look like a bang.
  let carried = 0
  nodes = Array.from({ length: count }, (_, index) => {
    const sx = seed?.[index * 2]
    const sy = seed?.[index * 2 + 1]
    if (sx !== undefined && sy !== undefined && Number.isFinite(sx) && Number.isFinite(sy)) {
      carried++
      return { index, x: sx, y: sy }
    }
    const angle = (index / Math.max(1, count)) * Math.PI * 2
    const radius = 40 + Math.sqrt(count) * 12
    return { index, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  })

  // The one allocation this simulation makes. It ping-pongs to the main thread
  // and back for the rest of its life.
  buffer = new Float32Array(count * 2)

  const links: Link[] = edges
    .filter(([a, b]) => a < count && b < count)
    .map(([a, b]) => ({ source: nodes[a]!, target: nodes[b]! }))

  simulation = forceSimulation(nodes)
    // Barnes-Hut approximation over a quadtree - this is what makes it O(n log n).
    .force('charge', forceManyBody<Node>().strength(-tunables.repelStrength).distanceMax(600))
    .force(
      'link',
      forceLink<Node, Link>(links).distance(tunables.linkDistance).strength(tunables.linkStrength),
    )
    .force('center', forceCenter(0, 0).strength(1))
    // Weak pull to the origin, so disconnected notes drift back instead of
    // flying off into empty space forever.
    .force('x', forceX(0).strength(tunables.centerStrength))
    .force('y', forceY(0).strength(tunables.centerStrength))
    .alphaDecay(0.02)
    // A mostly-carried layout is already near its answer; starting it at full
    // heat would shake a settled graph apart to arrive back where it was.
    .alpha(count > 0 && carried / count > 0.5 ? 0.35 : 1)
    .on('tick', post)
    .on('end', () => {
      const response: WorkerResponse = { kind: 'settled' }
      ctx.postMessage(response)
    })
}

ctx.onmessage = (event): void => {
  const message = event.data

  // The main thread returns the buffer it borrowed.
  if (message.positions !== undefined) {
    buffer = message.positions
    return
  }

  switch (message.kind) {
    case 'start':
      build(message.count, message.edges, message.tunables, message.seed)
      break

    case 'tunables': {
      if (simulation === null) break
      const charge = simulation.force('charge') as ReturnType<typeof forceManyBody<Node>> | undefined
      charge?.strength(-message.tunables.repelStrength)
      const link = simulation.force('link') as ReturnType<typeof forceLink<Node, Link>> | undefined
      link?.distance(message.tunables.linkDistance).strength(message.tunables.linkStrength)
      simulation.alpha(0.4).restart()
      break
    }

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
      nodes = []
      buffer = null
      break
  }
}
