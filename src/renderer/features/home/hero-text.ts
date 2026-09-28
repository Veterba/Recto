/**
 * What page one says and how it is set: the faces, the rules between lines,
 * the clock, the last edited note and the vault's path.
 */

import type { Rule } from './scene-text'
import type { FileNode } from '@shared/vault'

/**
 * Every face the page draws with, loaded explicitly.
 *
 * `document.fonts.ready` only waits for faces something has already asked
 * for; a face first used by the canvas rasteriser would still be missing on
 * the first draw, and the fallback would be frozen into the texture.
 */
const FACES = ['italic 400 100px "Bodoni Moda"', '500 30px "Geist Sans"', '500 11px "Geist Mono"'] as const

export const loadFaces = (): Promise<unknown> => Promise.all(FACES.map((face) => document.fonts.load(face)))

/**
 * How strongly the text texture draws meta labels and the faint rules, as a
 * fraction of full ink. The theme's own strengths (`--home-meta-ink`,
 * `--home-rule-ink`) are measured against these, so the texture itself is
 * drawn once whatever the theme.
 */
export const META_INK = 0.78
export const RULE_INK = 0.38

/**
 * The page's grid, in CSS px: margins, the column line at a third of the
 * width, the row line at 78% of the height. Ink at 38%, a gap either side of
 * each crossing, a full-ink crosshair where they meet and two ticks on the
 * row. Drawn into the text texture with everything else, so the river moves
 * them too.
 */
export function layoutRules(w: number, h: number): Rule[] {
  const M = 40
  const col = Math.round(w / 3)
  const row = Math.round(h * 0.78)
  const faint = RULE_INK
  const gap = 18
  const arm = 17
  return [
    { x: col, y: M, width: 1, height: row - gap - M, alpha: faint },
    { x: col, y: row + gap, width: 1, height: h - M - row - gap, alpha: faint },
    { x: M, y: row, width: col - gap - M, height: 1, alpha: faint },
    { x: col + gap, y: row, width: w - M - col - gap, height: 1, alpha: faint },
    { x: col - arm, y: row, width: 2 * arm + 1, height: 1, alpha: 1 },
    { x: col, y: row - arm, width: 1, height: 2 * arm + 1, alpha: 1 },
    { x: Math.round(w / 2), y: row - 4, width: 1, height: 9, alpha: faint },
    { x: Math.round((w * 3) / 4), y: row - 4, width: 1, height: 9, alpha: faint },
  ]
}

export const pad2 = (n: number): string => String(n).padStart(2, '0')

export const clockText = (d: Date): string =>
  `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`

/** The newest file in the tree, by modification time. */
export function lastEdited(roots: readonly FileNode[]): { name: string; at: Date } | null {
  let best: FileNode | null = null
  const walk = (nodes: readonly FileNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'folder') walk(n.children ?? [])
      else if (n.name.endsWith('.md') && (best === null || (n.mtime ?? 0) > (best.mtime ?? 0))) best = n
    }
  }
  walk(roots)
  const found = best as FileNode | null
  if (found === null || found.mtime === undefined) return null
  return { name: found.name.replace(/\.md$/, ''), at: new Date(found.mtime) }
}

/** A home folder written the way a shell would: ~ for /Users/you. */
export const tildePath = (path: string): string => path.replace(/^\/(Users|home)\/[^/]+/, '~')
