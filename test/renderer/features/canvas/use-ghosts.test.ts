// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Proposal } from '../../../../src/shared/ai-access'
import { parseCanvas, type CanvasDoc } from '../../../../src/shared/canvas'
import { IPC } from '../../../../src/shared/ipc'
import type { CanvasChange } from '../../../../src/renderer/features/canvas/canvas-change'
import { useGhosts } from '../../../../src/renderer/features/canvas/use-ghosts'

/** Accepting ghosts settles the proposal only when the canvas was written, and with the ids that were. */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'Plan.canvas'
const shown: CanvasDoc = parseCanvas(JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'Soil', x: 0, y: 0, width: 200, height: 100 }], edges: [] }))
const proposal: Proposal = {
  id: 'p1',
  client: 'quick-ask',
  tool: 'canvas_propose_nodes',
  summary: 'one card',
  created: 0,
  status: 'pending',
  files: [],
  formatted: [],
  canvas: {
    path: PATH,
    ops: [{ op: 'add-node', node: { ref: 'g1', type: 'text', text: 'Compost', x: 300, y: 0, width: 200, height: 100 } }],
    states: ['pending'],
    refs: {},
  },
} as Proposal

let settled: unknown[][]
beforeEach(() => {
  settled = []
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel === IPC.aiProposals) return [proposal]
    if (channel === IPC.aiProposalCanvas) settled.push(args)
    return null
  }
  ;(window as unknown as { api: unknown }).api = { invoke, on: () => () => undefined }
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

async function mount(edit: (change: CanvasChange) => Promise<boolean>): Promise<{ current: ReturnType<typeof useGhosts> }> {
  const out = {} as { current: ReturnType<typeof useGhosts> }
  const docRef = { current: shown }
  function Probe(): null {
    out.current = useGhosts(PATH, docRef, edit)
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(createElement(Probe)))
  await act(async () => undefined)
  return out
}

describe('accepting ghosts', () => {
  it('a canvas that could not be written settles nothing: the ghosts stay', async () => {
    const hook = await mount(async (change) => (change(shown), false))
    await act(async () => hook.current.accept([{ proposal, indexes: null }]))
    expect(settled).toEqual([])
  })

  it('written to a canvas that changed meanwhile: settled with the id the new card got there', async () => {
    let writtenId = ''
    const hook = await mount(async (change) => {
      change(shown)
      // The file had changed: the edit is made again to it, and that is what is written.
      const onDisk = { ...shown, nodes: [...shown.nodes, { id: 'b', type: 'text' as const, text: 'Obsidian', x: 0, y: 300, width: 200, height: 100 }] }
      const written = change(onDisk)
      writtenId = written.nodes.find((n) => n.type === 'text' && n.text === 'Compost')!.id
      return true
    })
    await act(async () => hook.current.accept([{ proposal, indexes: null }]))
    expect(settled).toEqual([['p1', ['accepted'], { g1: writtenId }]])
  })
})
