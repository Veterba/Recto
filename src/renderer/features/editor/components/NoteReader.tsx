import { useEffect, useRef, useState } from 'react'
import { api } from '../../../app/api'
import { hoverLink } from '../../../app/link-peek'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { Editor } from './Editor'
import type { EditorHandle } from '../editor-handle'

/**
 * A note to read, not to write: the editor, rendered and read-only, and kept
 * up to date with the file. What a floating note window shows.
 *
 * The same CodeMirror as the main editor, so a note reads exactly as it does
 * there - headings, tables, maths, callouts - with every line rendered, since
 * nobody is editing (see `activeLines` in live-preview.ts). Links go where
 * the caller says; hovering one shows its preview, which can be pinned too.
 */
export function NoteReader({
  path,
  onOpenLink,
}: {
  path: string
  onOpenLink: (target: string, heading: string | null) => void
}): React.ReactElement {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<EditorHandle | null>(null)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setError(null)
    const load = (): void => {
      void api.invoke(IPC.fsRead, path).then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setError(result.error)
          return
        }
        setError(null)
        setText(result.content)
        // Replaced in place once the editor exists, keeping the scroll.
        handle.current?.setValue(result.content)
      })
    }
    load()
    // Written by the main editor, or by anything else: read it again.
    const off = api.on(IPC_EVENT.vaultChanged, (changes) => {
      if (changes.some((c) => 'path' in c && c.path === path)) load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [path])

  if (error !== null) return <p className="note-reader__error">{error}</p>
  if (text === null) return <div className="note-reader__loading" />
  return (
    <div className="note-reader">
      <Editor
        docKey={path}
        initialValue={text}
        readOnly
        onChange={() => {}}
        onSave={() => {}}
        onOpenLink={onOpenLink}
        onLinkHover={(link) => hoverLink(link)}
        onReady={(editor) => {
          handle.current = editor
          // Tables, maths and frontmatter are laid out on a transaction, and a
          // read-only editor otherwise never gets one - the main editor always
          // does, with its settings, as it mounts. This is that transaction.
          editor.setLivePreview(true)
        }}
      />
    </div>
  )
}
