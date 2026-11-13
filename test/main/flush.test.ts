import { describe, expect, it, vi } from 'vitest'

/** Quitting or closing waits for the renderer to send what is unsaved, and for those writes to be on disk. */

let release: () => void = () => undefined
const settled = vi.fn(() => new Promise<void>((done) => (release = done)))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../src/main/vault-fs', () => ({ writesSettled: () => settled() }))

const { flushWindows, flushed } = await import('../../src/main/flush')

type Win = { isDestroyed: () => boolean; webContents: { send: (channel: string) => void } }
const window = (onSend: (channel: string) => void): Win => ({ isDestroyed: () => false, webContents: { send: onSend } })

describe('saving before a window goes', () => {
  it('asks the window, and is done only when its writes are on disk', async () => {
    const asked: string[] = []
    let done = false
    const flushing = flushWindows([window((c) => asked.push(c)) as never], 5000).then(() => (done = true))
    expect(asked).toEqual(['app:flush'])
    const answer = flushed()
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await answer
    await flushing
    expect(done).toBe(true)
  })

  it('a window that never answers is waited for only a while', async () => {
    vi.useFakeTimers()
    let done = false
    const flushing = flushWindows([window(() => undefined) as never], 2000).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(1999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await flushing
    expect(done).toBe(true)
    vi.useRealTimers()
  })
})
