import { canvasFiles, parseCanvas } from '../../shared/canvas'
import { requireDb } from './db'

/**
 * Canvases in the index: which files each one puts on it, and which notes
 * its edges join. Read from the .canvas file on every change, the way a note
 * is; a canvas that cannot be read keeps no rows, so it does not hold up the
 * rest. Only what backlinks, renames, the graph and the overview need.
 */

export function writeCanvas(relative: string, content: string, mtime: number, size: number): void {
  const db = requireDb()
  db.prepare(
    `INSERT INTO canvases (path, mtime, size) VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size`,
  ).run(relative, mtime, size)
  db.prepare('DELETE FROM canvas_nodes WHERE canvas = ?').run(relative)
  db.prepare('DELETE FROM canvas_edges WHERE canvas = ?').run(relative)
  let doc
  try {
    doc = parseCanvas(content)
  } catch {
    return
  }
  const insertNode = db.prepare('INSERT INTO canvas_nodes (canvas, node, target, subpath) VALUES (?, ?, ?, ?)')
  for (const f of canvasFiles(doc)) insertNode.run(relative, f.node, f.file, f.subpath)
  // Edges between two files: the graph draws those between notes.
  const fileOf = new Map(canvasFiles(doc).map((f) => [f.node, f.file]))
  const insertEdge = db.prepare('INSERT INTO canvas_edges (canvas, from_target, to_target, label) VALUES (?, ?, ?, ?)')
  for (const e of doc.edges) {
    const from = fileOf.get(e.fromNode)
    const to = fileOf.get(e.toNode)
    if (from !== undefined && to !== undefined && from !== to) insertEdge.run(relative, from, to, typeof e.label === 'string' ? e.label : null)
  }
}

export function removeCanvas(relative: string): void {
  const db = requireDb()
  db.prepare('DELETE FROM canvases WHERE path = ?').run(relative)
  db.prepare('DELETE FROM canvas_nodes WHERE canvas = ?').run(relative)
  db.prepare('DELETE FROM canvas_edges WHERE canvas = ?').run(relative)
}

/** The canvases a file is on, by name order. */
export function canvasesOf(target: string): string[] {
  return (requireDb().prepare('SELECT DISTINCT canvas FROM canvas_nodes WHERE target = ? ORDER BY canvas').all(target) as { canvas: string }[]).map((r) => r.canvas)
}

/** The canvases that put this file - or anything in this folder - on them: what a rename rewrites. */
export function canvasReferrers(target: string): string[] {
  return (
    requireDb()
      .prepare("SELECT DISTINCT canvas FROM canvas_nodes WHERE target = ? OR target LIKE ? ESCAPE '\\' ORDER BY canvas")
      .all(target, `${target.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`) as { canvas: string }[]
  ).map((r) => r.canvas)
}

/** Note nodes whose note is gone: shown on the canvas as a placeholder, and in the overview's "Needs attention". */
export function missingOnCanvases(): { canvas: string; target: string }[] {
  return requireDb()
    .prepare(
      `SELECT DISTINCT canvas, target FROM canvas_nodes
       WHERE lower(target) LIKE '%.md' AND target NOT IN (SELECT path FROM notes)
       ORDER BY canvas, target`,
    )
    .all() as { canvas: string; target: string }[]
}
