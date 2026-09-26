/**
 * The graph settings panel's sections, and the props the panel and its
 * sections share.
 */

import { type Tunables, DEFAULT_TUNABLES } from './protocol'
import type { GraphLook } from './look'
import type { GraphLayout } from './layout'
import type { LinkRange } from './degree-bins'

export type SectionId = 'layout' | 'links' | 'dots' | 'colour' | 'labels' | 'forces'

/** In the order the wheel shows them. "Nodes" are the links, "dots" the notes. */
export const SECTIONS: readonly { id: SectionId; name: string; icon: string; hue: string }[] = [
  { id: 'layout', name: 'Layout', icon: 'network', hue: '#8b5cf6' },
  { id: 'links', name: 'Nodes', icon: 'spline', hue: '#0ea5e9' },
  { id: 'dots', name: 'Dots', icon: 'circle-dot', hue: '#f43f5e' },
  { id: 'colour', name: 'Colour', icon: 'palette', hue: '#f59e0b' },
  { id: 'labels', name: 'Labels', icon: 'type', hue: '#10b981' },
  { id: 'forces', name: 'Forces', icon: 'magnet', hue: '#6366f1' },
]

/**
 * The mark under each Forces slider, at the value the graph starts on.
 *
 * Read off `DEFAULT_TUNABLES` rather than typed in, so a slider can never claim
 * a default the graph does not actually use - and so finding a better starting
 * point is one number to change, not five.
 */
export const DEFAULT_MARK: Record<keyof Tunables, readonly { value: number; label: string }[]> = {
  repelStrength: [{ value: DEFAULT_TUNABLES.repelStrength, label: 'Default' }],
  linkDistance: [{ value: DEFAULT_TUNABLES.linkDistance, label: 'Default' }],
  linkStrength: [{ value: DEFAULT_TUNABLES.linkStrength, label: 'Default' }],
  centerStrength: [{ value: DEFAULT_TUNABLES.centerStrength, label: 'Default' }],
  orphanPull: [{ value: DEFAULT_TUNABLES.orphanPull, label: 'Default' }],
}

export type GraphPanelProps = {
  look: GraphLook
  onLook: (next: GraphLook) => void
  layout: GraphLayout
  onLayout: (next: GraphLayout) => void
  tunables: Tunables
  onTunables: (next: Tunables) => void
  /** Notes per link-count bin, for the histogram. */
  linkBins: readonly number[]
  linkRange: LinkRange
  onLinkRange: (next: LinkRange) => void
  /** Notes on screen after filtering. */
  shown: number
  /** Plays the closing animation, then calls this. */
  onClose: () => void
}
