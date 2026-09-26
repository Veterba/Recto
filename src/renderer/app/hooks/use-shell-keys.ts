import { useEffect } from 'react'
import { api } from '../api'
import { IPC } from '@shared/ipc'
import { commands } from '../commands'
import { chordFromEvent, normalizeChord } from '../hotkeys'
import { HOME_HOTKEY, typingInField } from '../../features/home'
import { getWriting, toggleFocus } from '../../features/editor'

/**
 * The window's keyboard and drops: saved hotkeys loaded, every keystroke
 * offered to the command registry, Esc closing the pickers or leaving focus
 * mode, and stray file drops swallowed.
 */
export function useShellKeys({
  paletteOpen,
  searchOpen,
  switcherOpen,
  closePickers,
}: {
  paletteOpen: boolean
  searchOpen: boolean
  switcherOpen: boolean
  closePickers: () => void
}): void {
  /**
   * A file dropped anywhere but the editor is dropped nowhere.
   *
   * Chromium's default for a file drop is to navigate to it, which in a
   * single-page app means the window replaces itself with the image you were
   * trying to file. The editor's own handler takes the drops that matter; this
   * swallows the misses.
   */
  useEffect(() => {
    const swallow = (ev: DragEvent): void => {
      if (ev.dataTransfer?.types.includes('Files') !== true) return
      ev.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  useEffect(() => {
    void api.invoke(IPC.stateRead, 'hotkeys').then((saved) => {
      if (saved !== null && typeof saved === 'object') {
        commands.setOverrides(saved as Record<string, string | null>)
      }
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && (paletteOpen || searchOpen || switcherOpen)) {
        closePickers()
        return
      }
      // The home overlay's chord belongs to whatever you are typing into,
      // while you are typing into it - the note editor excepted, which is the
      // place you actually open it from.
      if (normalizeChord(HOME_HOTKEY) === chordFromEvent(ev) && typingInField()) return
      if (commands.handleKeyEvent(ev)) {
        ev.preventDefault()
        return
      }
      // Esc leaves focus mode - unless something else already used it: closing
      // an autocomplete, the search panel or a menu comes first.
      if (
        ev.key === 'Escape' &&
        !ev.defaultPrevented &&
        getWriting().focus &&
        document.querySelector('.wmenu, .cm-panels, .cm-tooltip-autocomplete') === null
      ) {
        toggleFocus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, searchOpen, switcherOpen])
}
