// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '../../../../src/shared/ipc'
import type { LinkPreview } from '../../../../src/shared/canvas'
import { refreshPreview, watchPreview } from '../../../../src/renderer/features/canvas/link-previews'

const URL = 'https://www.reddit.com/r/JapanTravel/'
const preview = (title: string): LinkPreview => ({ title, description: null, image: `data:image/jpeg;base64,${title}`, icon: null })
/** What main answers: the kept preview, or the page read again (`fresh`). */
let kept: LinkPreview | null = null
let fresh: LinkPreview | null = null
const asked: unknown[][] = []

beforeEach(() => {
  kept = preview('old')
  fresh = preview('new')
  asked.length = 0
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    asked.push([channel, ...args])
    return channel === IPC.canvasLinkPreview ? (args[1] === true ? fresh : kept) : null
  }
  ;(window as unknown as { api: unknown }).api = { invoke, on: () => () => undefined }
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('link previews on the canvas', () => {
  it('a card shows the kept preview, and every card with the link the new one once it is refreshed', async () => {
    const one: (LinkPreview | null)[] = []
    const two: (LinkPreview | null)[] = []
    const stopOne = watchPreview(URL, (p) => one.push(p))
    const stopTwo = watchPreview(URL, (p) => two.push(p))
    await settle()
    expect(one.at(-1)?.title).toBe('old')
    expect(await refreshPreview(URL)).toBe(true)
    expect(asked.at(-1)).toEqual([IPC.canvasLinkPreview, URL, true])
    expect(one.at(-1)?.title).toBe('new')
    expect(two.at(-1)?.title).toBe('new')
    stopOne()
    stopTwo()
  })

  it('when the page gives nothing this time, the card keeps what it had', async () => {
    fresh = null
    const shown: (LinkPreview | null)[] = []
    const stop = watchPreview(URL, (p) => shown.push(p))
    await settle()
    expect(await refreshPreview(URL)).toBe(false)
    expect(shown.map((p) => p?.title)).toEqual(['old'])
    stop()
  })

  it('a card taken off the canvas is not told any more', async () => {
    const shown: (LinkPreview | null)[] = []
    const stop = watchPreview(URL, (p) => shown.push(p))
    await settle()
    stop()
    await refreshPreview(URL)
    expect(shown.map((p) => p?.title)).toEqual(['old'])
  })
})
