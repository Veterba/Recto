import { powerMonitor } from 'electron'

/**
 * When the bots' background work may run: on the charger, with nobody at the
 * keyboard for a minute. It is the local model and the embedder working flat
 * out - fans, heat and battery - for something no one is waiting for, so it
 * waits for a moment that costs nothing. Typing anywhere (the editor
 * included) resets the system's idle time, so it also pauses the work.
 */

/** Seconds without a key or the pointer before background work starts. */
export const IDLE_SECONDS = 60
/** Fewer seconds than this since the last key: someone is typing, stop now. */
export const TYPING_SECONDS = 2

export type Gate = 'ok' | 'charger' | 'idle'

/** May the background work run now? 'charger': on battery. 'idle': someone is at the keyboard. */
export function backgroundGate(): Gate {
  if (powerMonitor.isOnBatteryPower()) return 'charger'
  if (powerMonitor.getSystemIdleTime() < IDLE_SECONDS) return 'idle'
  return 'ok'
}

/** Should work that is already running stop: unplugged, or a key pressed? */
export const shouldPause = (): boolean => powerMonitor.isOnBatteryPower() || powerMonitor.getSystemIdleTime() < TYPING_SECONDS
