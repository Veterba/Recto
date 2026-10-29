import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'

/**
 * A topics pass and a command (rename, delete, undo) never run at once: a pass
 * saves the state it read minutes ago, and a rename made meanwhile was lost.
 */

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), isPackaged: false, getAppPath: () => os.tmpdir(), on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  net: { isOnline: () => false },
  powerMonitor: { on: () => undefined },
  shell: {},
}))

const { exclusive } = await import('../../../src/main/topics/service')

describe('the topics lock', () => {
  it('runs a command only after the pass in progress, and the next pass after it', async () => {
    const order: string[] = []
    let endPass!: () => void
    const pass = exclusive(async () => {
      order.push('pass start')
      await new Promise<void>((resolve) => (endPass = resolve))
      order.push('pass end')
    })
    const rename = exclusive(async () => {
      order.push('rename')
    })
    const next = exclusive(async () => {
      order.push('next pass')
    })
    await Promise.resolve()
    expect(order).toEqual(['pass start'])
    endPass()
    await Promise.all([pass, rename, next])
    expect(order).toEqual(['pass start', 'pass end', 'rename', 'next pass'])
  })

  it('a step that throws does not stop the ones after it', async () => {
    const failed = exclusive(async () => {
      throw new Error('boom')
    })
    const after = exclusive(async () => 'ran')
    await expect(failed).rejects.toThrow('boom')
    await expect(after).resolves.toBe('ran')
  })
})
