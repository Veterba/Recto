import { useEffect, useRef } from 'react'
import { createEditor, type EditorHandle } from './codemirror'
import type { LinkCandidate } from './link-complete'

/**
 * React wrapper for the editor.
 *
 * React renders one empty div and never looks inside it again - CodeMirror owns
 * that DOM. The callbacks are held in refs so that a re-render never tears down
 * and rebuilds the editor, which would throw away undo history and the cursor.
 */

export type EditorProps = {
  /** Changing this remounts the editor - it identifies the document. */
  docKey: string
  initialValue: string
  onChange: (value: string) => void
  onSave: () => void
  onOpenLink: (target: string, heading: string | null) => void
  getLinkCandidates?: () => readonly LinkCandidate[]
  onSelectionChange?: () => void
  onFoldsChange?: (lines: number[]) => void
  onReady?: (handle: EditorHandle) => void
}

export function Editor({
  docKey,
  initialValue,
  onChange,
  onSave,
  onOpenLink,
  getLinkCandidates,
  onSelectionChange,
  onFoldsChange,
  onReady,
}: EditorProps): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null)
  const handle = useRef<EditorHandle | null>(null)

  // Latest callbacks, read through the ref, so identity changes on re-render
  // cannot cause a remount.
  const callbacks = useRef({ onChange, onSave, onOpenLink, onReady, getLinkCandidates, onSelectionChange, onFoldsChange })
  callbacks.current = { onChange, onSave, onOpenLink, onReady, getLinkCandidates, onSelectionChange, onFoldsChange }

  useEffect(() => {
    const parent = host.current
    if (!parent) return

    const editor = createEditor(parent, {
      doc: initialValue,
      onChange: (value) => callbacks.current.onChange(value),
      onSave: () => callbacks.current.onSave(),
      onOpenLink: (target, heading) => callbacks.current.onOpenLink(target, heading),
      getLinkCandidates: () => callbacks.current.getLinkCandidates?.() ?? [],
      onSelectionChange: () => callbacks.current.onSelectionChange?.(),
      onFoldsChange: (lines) => callbacks.current.onFoldsChange?.(lines),
    })
    handle.current = editor
    callbacks.current.onReady?.(editor)

    return () => {
      editor.destroy()
      handle.current = null
    }
    // `initialValue` is deliberately not a dependency: it is the *initial*
    // value. Later changes go through `setValue` on the handle, which preserves
    // history and the cursor instead of rebuilding the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  return <div className="cm-host" ref={host} />
}
