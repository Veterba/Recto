import { useCallback, useRef, useState } from 'react'
import { IPC } from '@shared/ipc'
import { withPictureEmbeds } from '@shared/chat-pictures'
import { api } from '../../app/api'
import { nameFor } from '../editor/images'

/** What a chat takes: pictures, and videos (sent as frames of them). */
export const isChatMedia = (file: File): boolean => file.type.startsWith('image/') || file.type.startsWith('video/')

/**
 * Pictures and videos waiting to go with the next message: pasted or dropped into the
 * composer, each put in the vault's attachments folder at once (as a note's
 * are), shown above the text until Send, then embedded in the message after
 * its words (shared/chat-pictures.ts).
 */
export function useChatPictures(): {
  pictures: string[]
  add: (files: readonly File[]) => Promise<string | null>
  remove: (path: string) => void
  /** The message with the pictures embedded; the pictures are not cleared (Send does that on success). */
  message: (text: string) => Promise<string>
  clear: () => void
  /** The pictures again, as they were (a message that could not be sent). */
  restore: (paths: readonly string[]) => void
} {
  const [pictures, setPictures] = useState<string[]>([])
  const add = useCallback(async (files: readonly File[]): Promise<string | null> => {
    let failed: string | null = null
    for (const file of files.filter(isChatMedia)) {
      const made = await api.invoke(IPC.fsImportData, nameFor(file), new Uint8Array(await file.arrayBuffer()))
      if (made.ok) setPictures((now) => [...now, made.path])
      else failed = made.error
    }
    return failed
  }, [])
  const remove = useCallback((path: string) => setPictures((now) => now.filter((p) => p !== path)), [])
  const message = useCallback(
    async (text: string): Promise<string> =>
      withPictureEmbeds(text, await Promise.all(pictures.map((p) => api.invoke(IPC.linksFormat, p, '', { embed: true })))),
    [pictures],
  )
  const clear = useCallback(() => setPictures([]), [])
  const restore = useCallback((paths: readonly string[]) => setPictures([...paths]), [])
  return { pictures, add, remove, message, clear, restore }
}

const carriesFiles = (event: React.DragEvent): boolean => [...event.dataTransfer.types].includes('Files')

/**
 * A chat as a drop target, as a Mac window is: pictures and videos dragged
 * from Finder or a browser onto any of it go with the next message. `dropping` while
 * files are over it, for the hint.
 */
export function usePictureDrop(take: (files: File[]) => void): {
  dropping: boolean
  handlers: Pick<React.DOMAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>
} {
  const [dropping, setDropping] = useState(false)
  // Enter and leave fire for every child crossed: over it while more entered than left.
  const depth = useRef(0)
  return {
    dropping,
    handlers: {
      onDragEnter: (event) => {
        if (!carriesFiles(event)) return
        depth.current++
        setDropping(true)
      },
      onDragOver: (event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (event) => {
        if (!carriesFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDropping(false)
      },
      onDrop: (event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        depth.current = 0
        setDropping(false)
        const files = [...event.dataTransfer.files].filter(isChatMedia)
        if (files.length > 0) take(files)
      },
    },
  }
}
