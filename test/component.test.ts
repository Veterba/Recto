import { describe, expect, it, vi } from 'vitest'
import { Component } from '../src/renderer/core/component'
import { Events } from '../src/renderer/core/events'

describe('Component lifecycle', () => {
  it('calls onload once, and again only after unload', () => {
    const onload = vi.fn()
    class C extends Component {
      override onload(): void { onload() }
    }
    const c = new C()
    c.load()
    c.load()
    expect(onload).toHaveBeenCalledTimes(1)
    c.unload()
    c.load()
    expect(onload).toHaveBeenCalledTimes(2)
  })

  it('runs cleanups in reverse order, then onunload', () => {
    const order: string[] = []
    class C extends Component {
      override onunload(): void { order.push('onunload') }
    }
    const c = new C()
    c.load()
    c.register(() => order.push('first'))
    c.register(() => order.push('second'))
    c.unload()
    expect(order).toEqual(['second', 'first', 'onunload'])
  })

  it('unloads children before its own cleanups', () => {
    const order: string[] = []
    class Child extends Component {
      constructor(private label: string) { super() }
      override onunload(): void { order.push(`child:${this.label}`) }
    }
    const parent = new Component()
    parent.load()
    parent.register(() => order.push('parent-cleanup'))
    parent.addChild(new Child('a'))
    parent.addChild(new Child('b'))
    parent.unload()
    expect(order).toEqual(['child:b', 'child:a', 'parent-cleanup'])
  })

  it('loads a child added to an already-loaded parent', () => {
    const onload = vi.fn()
    class Child extends Component {
      override onload(): void { onload() }
    }
    const parent = new Component()
    parent.load()
    parent.addChild(new Child())
    expect(onload).toHaveBeenCalledTimes(1)
  })

  it('detaches registered events on unload - the leak this class exists to stop', () => {
    const events = new Events<{ ping: readonly [n: number] }>()
    const seen: number[] = []
    const c = new Component()
    c.load()
    c.registerEvent(events.on('ping', (n) => seen.push(n)))
    events.trigger('ping', 1)
    c.unload()
    events.trigger('ping', 2)
    expect(seen).toEqual([1])
  })

  it('removeChild unloads it early and detaches it from later teardown', () => {
    const onunload = vi.fn()
    class Child extends Component {
      override onunload(): void { onunload() }
    }
    const parent = new Component()
    const child = new Child()
    parent.load()
    parent.addChild(child)
    parent.removeChild(child)
    expect(onunload).toHaveBeenCalledTimes(1)
    parent.unload()
    expect(onunload).toHaveBeenCalledTimes(1)
  })
})

describe('Events', () => {
  it('lets a listener detach itself mid-trigger without skipping others', () => {
    const events = new Events<{ tick: readonly [] }>()
    const seen: string[] = []
    const a = events.on('tick', () => { seen.push('a'); a.detach() })
    events.on('tick', () => seen.push('b'))
    events.trigger('tick')
    events.trigger('tick')
    expect(seen).toEqual(['a', 'b', 'b'])
  })

  it('once fires exactly once', () => {
    const events = new Events<{ go: readonly [] }>()
    const cb = vi.fn()
    events.once('go', cb)
    events.trigger('go')
    events.trigger('go')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('double-detach is a no-op', () => {
    const events = new Events<{ go: readonly [] }>()
    const cb = vi.fn()
    const ref = events.on('go', cb)
    ref.detach()
    ref.detach()
    events.trigger('go')
    expect(cb).not.toHaveBeenCalled()
  })
})
