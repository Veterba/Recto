import { useEffect } from 'react'
import { IPC } from '@shared/ipc'
import { activeSeconds, dayOf } from '@shared/overview'
import { api } from './api'

/**
 * What the vault overview counts as it happens, told to main (main/overview.ts).
 *
 * The day is this side's: the renderer's clock is the one the overview's sums
 * use, so a day is the same day at both ends.
 */

/**
 * You edited a note: a save from the editor, a card you changed or moved.
 * Called only where a person did it - never for Recto's own writes (link
 * updates on rename, a column renumbered, topics) or another app's.
 */
export function noteEdited(path: string): void {
  void api.invoke(IPC.overviewEdited, path, dayOf(new Date())).catch(() => undefined)
}

/** How often active time is counted and sent. */
const TICK_MS = 30_000

/**
 * Time in Recto and "last opened": counted while the vault is open.
 *
 * Time counts in thirty-second ticks, each one only if the window had focus
 * and a key or the pointer moved in the two minutes before it. A note counts
 * as opened when it becomes the one on screen.
 */
export function useUsageTracking(activePath: string | null): void {
  useEffect(() => {
    let lastInput = Date.now()
    // The window's own focus, as its focus and blur events report it.
    let focused = document.hasFocus()
    const onInput = (): void => {
      lastInput = Date.now()
    }
    const onFocus = (): void => {
      focused = true
    }
    const onBlur = (): void => {
      focused = false
    }
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const
    for (const name of events) window.addEventListener(name, onInput, { capture: true, passive: true })
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const timer = window.setInterval(() => {
      const now = Date.now()
      const seconds = activeSeconds(now, lastInput, focused, TICK_MS)
      if (seconds > 0) void api.invoke(IPC.overviewActive, dayOf(new Date(now)), seconds).catch(() => undefined)
    }, TICK_MS)
    return () => {
      for (const name of events) window.removeEventListener(name, onInput, { capture: true })
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (activePath !== null) void api.invoke(IPC.overviewOpened, activePath, Date.now()).catch(() => undefined)
  }, [activePath])
}
