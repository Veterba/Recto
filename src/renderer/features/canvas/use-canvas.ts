import { useCallback, useEffect, useRef, useState } from 'react'
import { CanvasParseError, parseCanvas, serializeCanvas, type CanvasDoc } from '@shared/canvas'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import { noteIndexChanged, useNoteBus } from '../../app/note-bus'
import { inverse, type CanvasChange } from './canvas-change'

/** How many steps undo goes back. */
const UNDO_LIMIT = 200

/**
 * One canvas file: read, shown, changed, written.
 *
 * Every change shows first and is written second, one write at a time. A
 * write reads the file again just before and makes the same change to what is
 * there now, so an edit made meanwhile in Obsidian is not written over. A
 * write that fails is undone on screen and said in a notice.
 *
 * Undo and redo are changes too - the inverse of each one, made to the
 * canvas as it is when you press ⌘Z.
 */
export function useCanvas(path: string): {
  doc: CanvasDoc | null
  error: string | null
  notice: string | null
  clearNotice: () => void
  edit: (change: CanvasChange) => Promise<boolean>
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
} {
  const [doc, setDoc] = useState<CanvasDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { revision } = useNoteBus()
  const docRef = useRef(doc)
  docRef.current = doc
  /** The file's text as last read or written; a read that finds the same text changes nothing. */
  const base = useRef<string | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)
  const undos = useRef<{ undo: CanvasChange; redo: CanvasChange }[]>([])
  const redos = useRef<{ undo: CanvasChange; redo: CanvasChange }[]>([])
  const [, setSteps] = useState(0)

  const read = useCallback(() => {
    void api.invoke(IPC.fsRead, path).then((got) => {
      if (!got.ok) {
        setError(got.error)
        return
      }
      // A write of ours is on its way: what is on screen is newer than the file.
      if (pending.current > 0 || got.content === base.current) return
      try {
        const next = parseCanvas(got.content)
        base.current = got.content
        setError(null)
        setDoc(next)
      } catch (err) {
        setError(err instanceof CanvasParseError ? err.message : String(err))
      }
    })
  }, [path])

  useEffect(read, [read, revision])

  /**
   * Shown now, written next: `change` is made to the canvas on screen, then
   * again to the file as it is - unless the file is what is on screen.
   * `made` is the change already worked out on the canvas shown, so it is not
   * made twice: a change that makes new ids (paste, group, an arrow) made a
   * second time gets other ids, and undo, keyed on the first, found nothing.
   */
  const apply = useCallback(
    (change: CanvasChange, made?: { from: CanvasDoc; to: CanvasDoc }): Promise<boolean> => {
      const shown = docRef.current
      if (shown === null) return Promise.resolve(false)
      const next = made !== undefined && made.from === shown ? made.to : change(shown)
      if (next === shown) return Promise.resolve(true)
      setDoc(next)
      // Now, not at the next render: a second edit in the same moment builds on this one.
      docRef.current = next
      pending.current++
      const run = async (): Promise<boolean> => {
        try {
          const got = await api.invoke(IPC.fsRead, path)
          let target = serializeCanvas(next)
          if (got.ok && got.content !== base.current) {
            try {
              target = serializeCanvas(change(parseCanvas(got.content)))
            } catch (err) {
              setNotice(
                `The canvas changed meanwhile and could not be read, so that was not saved. ${err instanceof Error ? err.message : ''}`.trim(),
              )
              return false
            }
          }
          const written = await api.invoke(IPC.fsWrite, path, target)
          if (!written.ok) {
            if (got.ok) {
              try {
                setDoc(parseCanvas(got.content))
              } catch {
                // What is on disk cannot be shown; the screen keeps the change until the next read.
              }
            }
            setNotice(`Couldn't save the canvas, so the change was undone. ${written.error ?? ''}`.trim())
            return false
          }
          base.current = target
          noteIndexChanged()
          return true
        } finally {
          pending.current--
          if (pending.current === 0) read()
        }
      }
      const result = queue.current.then(run, run)
      queue.current = result
      return result
    },
    [path, read],
  )

  const edit = useCallback(
    (change: CanvasChange): Promise<boolean> => {
      const shown = docRef.current
      if (shown === null) return Promise.resolve(false)
      const next = change(shown)
      const back = inverse(shown, next)
      if (back !== null) {
        const forward = inverse(next, shown)!
        undos.current = [...undos.current.slice(-(UNDO_LIMIT - 1)), { undo: back, redo: forward }]
        redos.current = []
        setSteps((n) => n + 1)
      }
      return apply(change, { from: shown, to: next })
    },
    [apply],
  )

  const undo = useCallback(() => {
    const step = undos.current.pop()
    if (step === undefined) return
    redos.current.push(step)
    setSteps((n) => n + 1)
    void apply(step.undo)
  }, [apply])

  const redo = useCallback(() => {
    const step = redos.current.pop()
    if (step === undefined) return
    undos.current.push(step)
    setSteps((n) => n + 1)
    void apply(step.redo)
  }, [apply])

  return {
    doc,
    error,
    notice,
    clearNotice: () => setNotice(null),
    edit,
    undo,
    redo,
    canUndo: undos.current.length > 0,
    canRedo: redos.current.length > 0,
  }
}
