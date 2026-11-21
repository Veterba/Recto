import { useSyncExternalStore } from 'react'
import { api } from '../../app/api'
import { IPC } from '@shared/ipc'
import { coerceSettings, typesFromObsidian, type PropertyKind } from '@shared/property-types'

/**
 * The vault's property types, for the properties panel: Recto's own
 * (`.recto/properties.json`) and Obsidian's (`.obsidian/types.json`, read only).
 * Loaded when a vault opens; a type chosen in the panel is written at once.
 */

export type PropertyTypes = { own: Readonly<Record<string, PropertyKind>>; obsidian: Readonly<Record<string, PropertyKind>> }

let current: PropertyTypes = { own: {}, obsidian: {} }
const listeners = new Set<() => void>()
const changed = (next: PropertyTypes): void => {
  current = next
  for (const listener of listeners) listener()
}

export async function loadPropertyTypes(): Promise<void> {
  const [own, obsidian] = await Promise.all([api.invoke(IPC.stateRead, 'properties'), api.invoke(IPC.fsReadText, '.obsidian/types.json')])
  changed({ own: coerceSettings(own).types, obsidian: typesFromObsidian(obsidian.ok ? obsidian.content : null) })
}

/** A property name's type, for every note of the vault. */
export function setPropertyType(key: string, kind: PropertyKind): void {
  const own = { ...current.own, [key]: kind }
  changed({ ...current, own })
  void api.invoke(IPC.stateWrite, 'properties', { types: own })
}

export const usePropertyTypes = (): PropertyTypes =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
