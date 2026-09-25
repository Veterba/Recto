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
/** `weak`: an auto-link, pulled at half strength. */
type Link = SimulationLinkDatum<Node> & { weak?: boolean }

const AUTO_LINK_STRENGTH = 0.5

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
/** Ticks posted so far, for thinning the stream on a big graph. */
let ticks = 0
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
  // Above a few hundred notes, transferring a frame every tick costs more than
  // it shows: the view eases between frames anyway.
  ticks++
  if (nodes.length > 600 && ticks % 2 === 1) return
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
/**
 * How hard a note pushes its neighbours away. The same for every note.
 *
 * Including the unlinked ones, which is what sorts the picture into Obsidian's
 * two parts. A note with no links feels only repulsion and the pull to the
 * middle, so it cannot rest inside the woven core - the core pushes it out
 * until the two forces balance, and since every unlinked note balances at the
 * same distance they settle into rings around the structure, evenly spaced by
 * their own collision. Weakening them (they used to push a third as hard) let
 * them sink into the mesh instead, which is why the graph read as one
 * undifferentiated heap.
 */
/**
 * How hard a note pushes every other note away. The same for all of them.
 *
 * Including the unlinked ones, and this is what draws Obsidian's rings. A note
 * with no links feels only this push and the pull to the middle; a crowd of
 * equal particles under those two forces does not scatter, it settles into
 * concentric shells - the same reason charges on a disc arrange themselves in
 * rings. The rings in Obsidian's graph are not placed there, they fall out of
 * the physics, and they only appear if the unlinked notes push as hard as
 * everything else and can feel the core from where they are.
 */
function charge(node: Node, repel: number): number {
  return -repel
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
  auto: readonly number[] = [],
): void {
  simulation?.stop()

  const degree = new Array<number>(count).fill(0)
  for (const [a, b] of edges) {
    if (a < count && b < count) {
      degree[a]!++
      degree[b]!++
    }
  }

  /*
   * Linked notes start in the middle, unlinked ones outside them.
   *
   * Both kinds used to be seeded on one sunflower spiral, deliberately, so that
   * no rings could form - which is the opposite of what the graph should show.
   * The final positions are still the simulation's to decide, and an unlinked
   * note is as draggable as any other; this only saves the physics from having
   * to push a few hundred of them out through the cluster first, which at any
   * sane cooling rate it never finishes doing.
   *
   * Each kind is laid on its own golden-angle spiral, which packs a disc evenly
   * without lining anything up into spokes.
   */
  let carried = 0
  let linkedSeen = 0
  let looseSeen = 0
  const linkedCount = degree.filter((d) => d > 0).length
  const core = 14 * Math.sqrt(Math.max(1, linkedCount))
  nodes = Array.from({ length: count }, (_, index) => {
    const d = degree[index] ?? 0
    const sx = seed?.[index * 2]
    const sy = seed?.[index * 2 + 1]
    if (sx !== undefined && sy !== undefined && Number.isFinite(sx) && Number.isFinite(sy)) {
      carried++
      return { index, degree: d, x: sx, y: sy }
    }
    const nth = d > 0 ? linkedSeen++ : looseSeen++
    const radius = d > 0 ? 12 * Math.sqrt(nth + 0.5) : core + 14 * Math.sqrt(nth + 0.5)
    const angle = nth * GOLDEN
    return { index, degree: d, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  })

  // The one allocation this simulation makes. It ping-pongs to the main thread
  // and back for the rest of its life.
  buffer = new Float32Array(count * 2)

  const weak = new Set(auto)
  const links: Link[] = []
  const valid: [number, number][] = []
  edges.forEach(([a, b], i) => {
    if (a >= count || b >= count) return
    valid.push([a, b])
    links.push({ source: nodes[a]!, target: nodes[b]!, weak: weak.has(i) })
  })

  current = { edges: valid, tunables, layout, groups, sizing, targets: null }

  simulation = forceSimulation(nodes)
    .force('link', forceLink<Node, Link>(links))
    // Nodes never overlap: a dot that sits on another is a dot you cannot see
    // or click, and piles of them are most of what made the graph look messy.
    .force('center', forceCenter(0, 0).strength(1))
    // Heavier damping than d3's default: with a few thousand notes a lighter
    // one lets the whole graph wobble for seconds after any nudge.
    .velocityDecay(0.42)
    /*
     * Cools in ~220 ticks.
     *
     * It was ~150, which is quick enough to look settled but not enough for a
     * few hundred unlinked notes to sort themselves into rings around the
     * cluster: that arrangement is an equilibrium the simulation has to be
     * given time to find, and it was freezing halfway there.
     */
    .alphaDecay(0.032)
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
/**
 * The note under the pointer right now, if any.
 *
 * A dragged note's own links are put on a short leash while the gesture lasts:
 * stronger, and wanting to sit closer. Obsidian's dragged note tows its
 * neighbours in a tight bundle, and d3's degree normalisation is what stopped
 * that here - a hub's links are divided by its degree, so pulling a hub with
 * forty links moved almost nothing and the links just stretched.
 */
let dragging: number | null = null

/** Does this link touch the note being dragged? */
const leashed = (link: Link): boolean =>
  dragging !== null && ((link.source as Node).index === dragging || (link.target as Node).index === dragging)

/**
 * Set the spring lengths and strengths.
 *
 * Its own function because d3 reads these once, when the accessor is set - so
 * picking a note up or putting it down has to set them again for the leash to
 * take effect.
 */
function tuneLinks(): void {
  if (simulation === null || current === null) return
  const { tunables, groups, targets } = current
  const cross = targets?.crossGroupLinks ?? 1
  const link = simulation.force('link') as ReturnType<typeof forceLink<Node, Link>> | undefined
  link
    ?.distance((l) => {
      const base = linkLength(l, tunables.linkDistance)
      return leashed(l) ? base * 0.62 : base
    })
    /*
     * d3's own normalisation, times the slider.
     *
     * A flat strength pulls a hub with twenty links twenty times as hard as a
     * leaf with one, so hubs collapse into knots and the graph reads as blobs
     * joined by threads. Dividing by the smaller endpoint's degree - which is
     * what d3 does by default, and what makes Obsidian's graph look evenly
     * woven - spreads that pull over the links that share it.
     *
     * The exception is the note in your hand: its links hold at a floor no
     * matter how many of them there are, or dragging a hub leaves its
     * neighbours behind.
     */
    .strength((l) => {
      const a = (l.source as Node).degree
      const b = (l.target as Node).degree
      const share = 1 / Math.max(1, Math.min(a, b))
      const same = groups[(l.source as Node).index] === groups[(l.target as Node).index]
      // Auto-links pull at half strength: the links the user wrote stay the
      // shape of the graph however many auto-links accumulate around them.
      const base = tunables.linkStrength * share * (targets?.links ?? 1) * (same ? 1 : cross) * (l.weak === true ? AUTO_LINK_STRENGTH : 1)
      return leashed(l) ? Math.max(base, 0.4) : base
    })
}

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
  /*
   * Reach: far enough for the core to push the outermost notes.
   *
   * A 420px cap was a performance habit from before Barnes-Hut was doing the
   * work, and it quietly broke the shape: a note beyond that distance felt
   * nothing from the cluster, so it stopped where it happened to be instead of
   * being pushed out to where the centre pull balances the push. That is a
   * scatter rather than a ring. Scaled with the graph, because a thousand notes
   * settle into a wider disc than fifty.
   */
  const reach = Math.max(900, 90 * Math.sqrt(nodes.length))
  simulation.force(
    'charge',
    forceManyBody<Node>()
      .strength((node) => charge(node, tunables.repelStrength) * (targets?.charge ?? 1))
      .distanceMax(structured ? 420 : reach),
  )

  tuneLinks()

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
    /*
     * Two pulls toward the middle, so there is a gap between the web and the
     * notes that are not part of it.
     *
     * A note with no links feels nothing but the crowd pushing it outward and
     * the centre holding it in, so where it settles is set entirely by that
     * tether: loosen it and the whole unlinked population moves out together,
     * leaving a band of empty space around the linked core - which is what
     * Obsidian's graph looks like, and what one shared pull could not produce,
     * because the springs already pull the linked notes inward on top of it.
     */
    const pull = (node: Node): number => tunables.centerStrength * 1.4 * (node.degree === 0 ? tunables.orphanPull : 1)
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
      build(message.count, message.edges, message.tunables, message.layout, message.groups, message.sizing, message.seed, message.auto)
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
      // Hot enough to travel all the way from one shape to the other, but not
      // so hot that the graph snaps there: the view eases positions as well.
      simulation.alphaTarget(0).alpha(0.75).restart()
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
      /**
       * Only the dragged note is pinned. Everything else is free.
       *
       * It used to pin the whole graph bar the note's own neighbourhood, to
       * keep a gesture from rearranging a thousand dots - but that also froze
       * the thing the gesture is for. In Obsidian the note you pull tows its
       * links, they tow theirs, and the web stretches and recovers; pinned, the
       * neighbours sat still and the dragged dot slid through the picture like
       * a cutout. The web is the point.
       */
      node.fx = message.x
      node.fy = message.y
      if (dragging !== message.index) {
        dragging = message.index
        tuneLinks()
        // Lighter damping while the hand is moving: the neighbourhood has to
        // keep up with a pointer, not settle politely after it.
        simulation?.velocityDecay(0.3)
      }
      /**
       * Warm, not barely awake.
       *
       * d3's own drag keeps `alphaTarget` at 0.3 for exactly this: high enough
       * that the neighbours follow while the pointer moves, low enough that the
       * layout is not re-run from scratch. At 0.06 the graph could not keep up
       * with the hand, so links stretched and nothing followed.
       */
      simulation?.alphaTarget(0.3).restart()
      break
    }

    case 'release': {
      const node = nodes[message.index]
      if (node === undefined) break
      /*
       * Released, it is let go rather than left where it was dropped: the
       * forces take it the last short distance to wherever the links want it,
       * which is why a dragged note in Obsidian drifts to meet the notes it is
       * linked to instead of hanging exactly under the cursor.
       */
      delete node.fx
      delete node.fy
      if (dragging !== null) {
        dragging = null
        tuneLinks()
        simulation?.velocityDecay(0.42)
      }
      simulation?.alphaTarget(0)
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
