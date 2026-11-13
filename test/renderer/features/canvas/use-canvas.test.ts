// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '../../../../src/shared/ipc'
import { parseCanvas, type CanvasDoc } from '../../../../src/shared/canvas'
import { useCanvas } from '../../../../src/renderer/features/canvas/use-canvas'

/** The canvas hook on a file in memory that another app (Obsidian, sync) can change at any moment. */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'Trip.canvas'
const node = (id: string, x = 0): object => ({ id, type: 'text', text: id, x, y: 0, width: 100, height: 50 })
let file = ''

beforeEach(() => {
  file = JSON.stringify({ nodes: [node('a')], edges: [] })
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel === IPC.fsRead) return { ok: true, content: file }
    if (channel === IPC.fsWrite) {
      file = args[1] as string
      return { ok: true }
    }
    return null
  }
  ;(window as unknown as { api: unknown }).api = { invoke, on: () => () => undefined }
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

async function mount(): Promise<{ current: ReturnType<typeof useCanvas> }> {
  const out = {} as { current: ReturnType<typeof useCanvas> }
  function Probe(): null {
    out.current = useCanvas(PATH)
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(createElement(Probe)))
  await act(async () => undefined)
  return out
}

const move = (id: string, x: number) => (d: CanvasDoc): CanvasDoc => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, x } : n)) })
const ids = (text: string): string[] => parseCanvas(text).nodes.map((n) => n.id)

describe('a canvas changed by another app while it is edited', () => {
  it('keeps the other app’s node through this edit and every later one, and shows it', async () => {
    const hook = await mount()
    expect(hook.current.doc?.nodes.map((n) => n.id)).toEqual(['a'])
    // Obsidian adds a node; the watcher has not told the canvas yet.
    file = JSON.stringify({ nodes: [node('a'), node('b')], edges: [] })
    await act(async () => void (await hook.current.edit(move('a', 10))))
    expect(ids(file)).toEqual(['a', 'b'])
    await act(async () => void (await hook.current.edit(move('a', 20))))
    expect(ids(file)).toEqual(['a', 'b'])
    expect(hook.current.doc?.nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })
})
