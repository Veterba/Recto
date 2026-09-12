import type { EventRef } from './events'

/**
 * Lifecycle base class.
 *
 * Without a VDOM owning CodeMirror, the Pixi canvas and IPC subscriptions,
 * this is the only thing standing between us and permanent listener leaks.
 * Anything registered through a `register*` method is torn down on unload,
 * children first, in reverse order of registration.
 *
 * Impossible to retrofit, so it exists before anything uses it.
 */
export class Component {
  private loaded = false
  private children: Component[] = []
  private cleanups: (() => void)[] = []

  /** Override. Called once when this component (or its parent) loads. */
  onload(): void {}

  /** Override. Called once on unload, AFTER children and registrations are torn down. */
  onunload(): void {}

  get isLoaded(): boolean {
    return this.loaded
  }

  load(): void {
    if (this.loaded) return
    this.loaded = true
    this.onload()
    for (const child of this.children) child.load()
  }

  unload(): void {
    if (!this.loaded) return
    this.loaded = false
    while (this.children.length > 0) this.children.pop()?.unload()
    while (this.cleanups.length > 0) this.cleanups.pop()?.()
    this.onunload()
  }

  /** Adopt a child. Loads it immediately if we are already loaded. */
  addChild<T extends Component>(child: T): T {
    this.children.push(child)
    if (this.loaded) child.load()
    return child
  }

  /** Detach and unload a child early. */
  removeChild(child: Component): void {
    const i = this.children.indexOf(child)
    if (i === -1) return
    this.children.splice(i, 1)
    child.unload()
  }

  /** Run `cleanup` on unload. The primitive the rest are built on. */
  register(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  registerEvent(ref: EventRef): void {
    this.register(() => ref.detach())
  }

  registerDomEvent<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    cb: (ev: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void
  registerDomEvent<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    cb: (ev: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    cb: (ev: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void
  registerDomEvent(
    target: EventTarget,
    type: string,
    cb: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, cb, options)
    this.register(() => target.removeEventListener(type, cb, options))
  }

  registerInterval(ms: number, cb: () => void): void {
    const id = window.setInterval(cb, ms)
    this.register(() => window.clearInterval(id))
  }

  registerTimeout(ms: number, cb: () => void): void {
    const id = window.setTimeout(cb, ms)
    this.register(() => window.clearTimeout(id))
  }
}
