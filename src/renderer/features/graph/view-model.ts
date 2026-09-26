import type { GraphInfo } from '@shared/index-results'
import { CARD_FOLDER } from '../boards'
import { CHAT_FOLDER } from '../ai'
import type { GraphNodeView } from './render-state'
import { histogram, inRange, type LinkRange } from './degree-bins'

/**
 * What the graph shows of the index's graph: the filters applied, nodes
 * numbered, edges as index pairs. Pure, so the view can memoise it.
 */

const SEP = ' '
const GROUP_SEP = ''

/** Identity of the *structure*, so a body edit does not rebuild the layout. */
export function signature(graph: GraphInfo | null): string {
  if (graph === null) return ''
  const nodes = graph.nodes.map((node) => node.path).join(SEP)
  const edges = graph.edges.map((edge) => `${edge.source}>${edge.target}${edge.auto ? '~' : ''}`).join(SEP)
  return `${nodes}${GROUP_SEP}${edges}`
}

type GraphFilters = {
  showOrphans: boolean
  showTasks: boolean
  showChats: boolean
  linkRange: LinkRange
  localOnly: boolean
  activePath: string | null
}

export type GraphViewModel = {
  nodes: GraphNodeView[]
  edges: [number, number][]
  /** Indices into `edges` of the links only the topics property makes. */
  auto: number[]
  paths: string[]
  groups: number[]
  bins: ReturnType<typeof histogram>
}

/** Nodes actually shown, after the filters. */
export function visibleGraph(
  graph: GraphInfo | null,
  { showOrphans, showTasks, showChats, linkRange, localOnly, activePath }: GraphFilters,
): GraphViewModel {
  if (graph === null) {
    return {
      nodes: [] as GraphNodeView[],
      edges: [] as [number, number][],
      auto: [] as number[],
      paths: [] as string[],
      groups: [] as number[],
      bins: histogram([]),
    }
  }

  // Task cards first: the Data tree hides the folder they live in, so showing
  // them here made three real notes look like ghosts the app had failed to
  // forget. Whichever way it is set, the two lists now agree.
  //
  // Templates used to be filtered here too, back when their folder was
  // hidden. It is a visible, configurable folder now, so they are ordinary
  // notes in the graph - hiding a hard-coded `templates/` would have hidden
  // the old default and none of a vault's real templates.
  const visible = graph.nodes.filter(
    (node) => (showTasks || !node.path.startsWith(`${CARD_FOLDER}/`)) && (showChats || !node.path.startsWith(`${CHAT_FOLDER}/`)),
  )
  let kept = visible.filter((node) => (showOrphans || node.degree > 0) && inRange(node.degree, linkRange))

  // Only what the open note touches: the note itself and everything linked to
  // it either way. With no note open there is nothing to be local to, so the
  // switch waits rather than emptying the graph.
  if (localOnly && activePath !== null) {
    const near = new Set<string>([activePath])
    for (const edge of graph.edges) {
      if (edge.source === activePath) near.add(edge.target)
      else if (edge.target === activePath) near.add(edge.source)
    }
    if (near.size > 1 || visible.some((node) => node.path === activePath)) {
      kept = kept.filter((node) => near.has(node.path))
    }
  }
  const indexOf = new Map(kept.map((node, i) => [node.path, i]))
  // Top-level folder per note, as a small integer: notes at the vault root
  // share one group. Ordered by name so a folder keeps its colour.
  const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '')
  const folders = [...new Set(kept.map((node) => folderOf(node.path)))].sort()
  const groupIndex = new Map(folders.map((folder, i) => [folder, i]))
  const groups = kept.map((node) => groupIndex.get(folderOf(node.path)) ?? 0)

  const nodes: GraphNodeView[] = kept.map((node) => ({
    path: node.path,
    // The FILE name, never the H1. Two notes can share a heading, a heading
    // can be renamed without the file moving, and a graph where a node's
    // label does not match anything in the sidebar is a graph you cannot use
    // to find the note.
    label: node.name,
    topic: node.topic,
    degree: node.degree,
    group: groupIndex.get(folderOf(node.path)) ?? 0,
  }))
  const edges: [number, number][] = []
  /** Indices into `edges` of the links only the topics property makes. */
  const auto: number[] = []
  for (const edge of graph.edges) {
    const a = indexOf.get(edge.source)
    const b = indexOf.get(edge.target)
    if (a === undefined || b === undefined) continue
    if (edge.auto) auto.push(edges.length)
    edges.push([a, b])
  }
  // Counted before the link filter, so the histogram shows what there is to choose from.
  const bins = histogram(visible.filter((node) => showOrphans || node.degree > 0).map((node) => node.degree))
  return { nodes, edges, auto, paths: kept.map((node) => node.path), groups, bins }
}
