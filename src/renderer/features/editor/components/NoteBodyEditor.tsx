import { useEffect, useRef, useState } from 'react'
import { Editor } from './Editor'
import type { EditorHandle } from '../editor-handle'
import { currentLinkCandidates } from './MarkdownView'

/**
 * A note's text, edited in place somewhere other than its tab - a card's panel.
 *
 * The same editor as the note's own, in live preview, so Markdown renders as
 * it is typed and a `- [ ]` is a box to tick; only the body is in it, the
 * frontmatter is the caller's. Changes go out as they are typed (the caller
 * debounces the write); a change from outside replaces the text only while
 * nobody is typing in it.
 */
export function NoteBodyEditor({
  docKey,
  value,
  placeholder,
  onChange,
  onOpenLink,
}: {
  docKey: string
  value: string
  /** Shown over an empty body. */
  placeholder: string
  onChange: (value: string) => void
  onOpenLink: (target: string, heading: string | null) => void
}): React.ReactElement {
  const handle = useRef<EditorHandle | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const typed = useRef(value)
  const [empty, setEmpty] = useState(value.trim() === '')

  useEffect(() => {
    if (value === typed.current) return
    if (host.current?.contains(document.activeElement) === true) return
    typed.current = value
    handle.current?.setValue(value)
    setEmpty(value.trim() === '')
  }, [value])

  return (
    <div className={`note-body${empty ? ' is-empty' : ''}`} ref={host} data-placeholder={placeholder}>
      <Editor
        docKey={docKey}
        initialValue={value}
        onChange={(next) => {
          typed.current = next
          setEmpty(next.trim() === '')
          onChange(next)
        }}
        onSave={() => {}}
        onOpenLink={onOpenLink}
        getLinkCandidates={currentLinkCandidates}
        onReady={(editor) => {
          handle.current = editor
          editor.setLivePreview(true)
        }}
      />
    </div>
  )
}
