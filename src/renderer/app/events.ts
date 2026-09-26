/**
 * A typed event emitter.
 *
 * Obsidian's equivalent is stringly-typed; generic over an event map means the
 * payload of every listener is checked at the call site instead.
 *
 * `on()` returns an opaque ref rather than requiring you to keep the original
 * callback around, so `Component.registerEvent(ref)` can unsubscribe on unload.
 */

export type EventMap = Record<string, readonly unknown[]>

export type EventRef = {
  readonly __brand: 'EventRef'
  detach(): void
}

/** The erased listener shape stored in the map. Widened once, on `on()`. */
type StoredListener = (...args: readonly unknown[]) => void

export class Events<M extends EventMap> {
  private listeners = new Map<PropertyKey, Set<StoredListener>>()

  on<K extends keyof M>(name: K, cb: (...args: M[K]) => void): EventRef {
    let set = this.listeners.get(name)
    if (!set) {
      set = new Set()
      this.listeners.set(name, set)
    }
    const fn = cb as unknown as StoredListener
    set.add(fn)
    let detached = false
    return {
      __brand: 'EventRef',
      detach: () => {
        if (detached) return
        detached = true
        set.delete(fn)
      },
    } as EventRef
  }

  /** Subscribe for exactly one firing. */
  once<K extends keyof M>(name: K, cb: (...args: M[K]) => void): EventRef {
    const ref = this.on(name, ((...args: M[K]) => {
      ref.detach()
      cb(...args)
    }) as (...args: M[K]) => void)
    return ref
  }

  trigger<K extends keyof M>(name: K, ...args: M[K]): void {
    const set = this.listeners.get(name)
    if (!set) return
    // Copy: a listener may detach itself or others while we iterate.
    for (const fn of [...set]) fn(...args)
  }

  offAll(): void {
    this.listeners.clear()
  }
}
