import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { api } from '../api'

/**
 * Drop or paste a picture into a note.
 *
 * The bytes go into the vault's attachments folder and the note gets an
 * ordinary `![](attachments/…)` - no attachment record, no blob store. A note
 * that references a file next to it stays a note when you open the folder in
 * anything else, which is the whole promise.
 *
 * Bytes rather than the source path: a drag out of a browser and a pasted
 * screenshot have no path at all, and in Electron 44 a dragged `File` has no
 * usable `.path` either. One code path covers all three.
 */

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
}

const stamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')

/** A clipboard image arrives as `image.png`, or as nothing at all. */
function nameFor(file: File): string {
  if (file.name !== '' && file.name !== 'image.png') return file.name
  return `pasted-${stamp()}.${EXT[file.type] ?? 'png'}`
}

const isImage = (file: File): boolean => file.type.startsWith('image/')

async function importAt(view: EditorView, files: readonly File[], at: number): Promise<void> {
  const markdown: string[] = []
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await api.invoke('fs:import-data', nameFor(file), bytes)
    if (!result.ok) continue
    const label = result.path.slice(result.path.lastIndexOf('/') + 1)
    markdown.push(`![${label}](${encodeURI(result.path)})`)
  }
  if (markdown.length === 0) return

  // On its own line, and never welded onto the text already there: dropping a
  // photo into the middle of a sentence is a miss, not an instruction.
  const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length))
  const insert = `${line.text.trim() === '' ? '' : '\n'}${markdown.join('\n')}\n`
  const pos = line.text.trim() === '' ? line.from : line.to

  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
    scrollIntoView: true,
    userEvent: 'input.image',
  })
}

export function imageDrop(): Extension {
  return EditorView.domEventHandlers({
    drop: (event, view) => {
      const files = [...(event.dataTransfer?.files ?? [])].filter(isImage)
      if (files.length === 0) return false
      event.preventDefault()
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
      void importAt(view, files, at)
      return true
    },
    dragover: (event) => {
      // Without this the drag shows a "no entry" cursor the whole way in, and
      // Chromium keeps its own default of navigating to the dropped file.
      if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) return false
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      return true
    },
    paste: (event, view) => {
      const files = [...(event.clipboardData?.files ?? [])].filter(isImage)
      if (files.length === 0) return false
      event.preventDefault()
      void importAt(view, files, view.state.selection.main.head)
      return true
    },
  })
}
