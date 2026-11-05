import { useEffect, useSyncExternalStore } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import { boundsOf, fromSvg, toSvg, type Box, type Stroke } from './drawing'

/**
 * Drawings as they are now: each one's strokes (relative to its file's box)
 * and that box's size, read once from its SVG and changed here as strokes are
 * added or erased - then written back. Null: the SVG is not one Recto drew.
 */

export type Drawn = { width: number; height: number; strokes: Stroke[] }

const drawings = new Map<string, Drawn | null>()
const loading = new Set<string>()
const listeners = new Set<() => void>()
const tell = (): void => {
  for (const l of listeners) l()
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function load(path: string): void {
  if (drawings.has(path) || loading.has(path)) return
  loading.add(path)
  void api.invoke(IPC.fsReadText, path).then((got) => {
    loading.delete(path)
    const strokes = got.ok ? fromSvg(got.content) : null
    const size = got.ok ? /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(got.content) : null
    drawings.set(path, strokes === null || size === null ? null : { width: Number(size[1]), height: Number(size[2]), strokes })
    tell()
  })
}

/** A drawing's strokes, or null for an SVG Recto did not draw, or undefined while it is read. */
export function useDrawing(path: string): Drawn | null | undefined {
  useEffect(() => load(path), [path])
  return useSyncExternalStore(subscribe, () => drawings.get(path))
}

/** A drawing as it is, read if it has not been (for adding to it). */
export async function drawingOf(path: string): Promise<Drawn | null> {
  if (drawings.has(path)) return drawings.get(path) ?? null
  const got = await api.invoke(IPC.fsReadText, path)
  load(path)
  if (!got.ok) return null
  const strokes = fromSvg(got.content)
  const size = /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(got.content)
  return strokes === null || size === null ? null : { width: Number(size[1]), height: Number(size[2]), strokes }
}

/**
 * A drawing's strokes (in canvas units) written to its SVG: the box round
 * them is the file's, and the node's new place and size.
 */
export async function saveDrawing(path: string, strokes: readonly Stroke[]): Promise<{ ok: true; box: Box } | { ok: false; error: string }> {
  const box = boundsOf(strokes)
  const svg = toSvg(strokes, box)
  const written = await api.invoke(IPC.fsWrite, path, svg)
  if (!written.ok) return { ok: false, error: written.error ?? 'The drawing could not be saved.' }
  const local = fromSvg(svg) ?? []
  drawings.set(path, { width: Math.round(box.width), height: Math.round(box.height), strokes: local })
  tell()
  return { ok: true, box }
}
