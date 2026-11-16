import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) } }))
vi.mock('../../src/main/link-context', () => ({ currentLinkVault: () => ({ files: [] }) }))
vi.mock('../../src/main/vault-fs', () => ({ readBytes: async () => ({ ok: false, error: 'none' }) }))
vi.mock('../../src/main/video-frames', () => ({ videoFrames: async () => null }))

const { asksWithPicture, clock, FRAMES_PER_VIDEO, framesSaid, MAX_PICTURES, MAX_VIDEOS, withPictures } = await import('../../src/main/chat-pictures')

/** A vault of pictures by name: what each embed finds, read as its own name. */
const deps = (files: Record<string, string>) => ({
  resolve: (target: string) => (target in files ? files[target]! : null),
  read: async (path: string) => new TextEncoder().encode(path),
  prepare: (bytes: Uint8Array) => ({ mime: 'image/png', data: new TextDecoder().decode(bytes) }),
  // A video of 84 s: its frames spread over it, each named by the video and its second.
  frames: async (path: string, count: number) =>
    path.includes('broken') ? null : { duration: 84, frames: Array.from({ length: Math.min(count, 3) }, (_, i) => ({ at: 14 + i * 28, image: { mime: 'image/jpeg', data: `${path}@${14 + i * 28}` } })) },
})

describe('pictures read for a model', () => {
  it('each person’s message gets its own pictures, in order, and says where each was', async () => {
    const out = await withPictures(
      [
        { role: 'user', content: 'Two: ![[a.png]] and ![[b.png]]' },
        { role: 'assistant', content: 'I see ![[a.png]]' },
      ],
      deps({ 'a.png': 'att/a.png', 'b.png': 'att/b.png' }),
    )
    expect(out[0]).toEqual({ role: 'user', content: 'Two: [picture 1: a.png] and [picture 2: b.png]', images: [{ mime: 'image/png', data: 'att/a.png' }, { mime: 'image/png', data: 'att/b.png' }] })
    // An answer's embeds are not the person's pictures.
    expect(out[1]).toEqual({ role: 'assistant', content: 'I see ![[a.png]]' })
  })

  it('a picture that is not there is said so, and the message still goes', async () => {
    const out = await withPictures([{ role: 'user', content: 'This? ![[gone.png]]' }], deps({}))
    expect(out[0]).toEqual({ role: 'user', content: 'This? [picture gone.png: could not be read]' })
  })

  it(`the newest ${MAX_PICTURES} go; older ones stay as their names`, async () => {
    const files: Record<string, string> = {}
    const messages = Array.from({ length: MAX_PICTURES + 2 }, (_, i) => {
      files[`p${i}.png`] = `p${i}.png`
      return { role: 'user' as const, content: `![[p${i}.png]]` }
    })
    const out = await withPictures(messages, deps(files))
    expect(out.filter((m) => m.images !== undefined)).toHaveLength(MAX_PICTURES)
    expect(out[0]!.content).toBe('[picture p0.png: sent earlier]')
    expect(out.at(-1)!.images).toEqual([{ mime: 'image/png', data: `p${MAX_PICTURES + 1}.png` }])
  })

  it('a conversation without pictures is sent as it is', async () => {
    const messages = [{ role: 'user' as const, content: 'Soil?' }]
    expect(await withPictures(messages, deps({}))).toEqual(messages)
  })

  it('a video goes as its frames, in order with the pictures, and its text says which pictures are its frames and when', async () => {
    const out = await withPictures([{ role: 'user', content: 'Before ![[a.png]] then ![[clip.mov]]' }], deps({ 'a.png': 'a.png', 'clip.mov': 'att/clip.mov' }))
    expect(out[0]!.content).toBe(
      'Before [picture 1: a.png] then [video: clip.mov, 1:24 long - sent as 3 frames in order (pictures 2-4), at 0:14, 0:42, 1:10; together they show what happens in it]',
    )
    expect(out[0]!.images!.map((i) => i.data)).toEqual(['a.png', 'att/clip.mov@14', 'att/clip.mov@42', 'att/clip.mov@70'])
  })

  it('a video that cannot be read is said so; the newest videos go, older ones as their names', async () => {
    expect((await withPictures([{ role: 'user', content: '![[broken.mp4]]' }], deps({ 'broken.mp4': 'broken.mp4' })))[0]!.content).toBe(
      '[video broken.mp4: could not be read]',
    )
    const files: Record<string, string> = {}
    const messages = Array.from({ length: MAX_VIDEOS + 1 }, (_, i) => {
      files[`v${i}.mp4`] = `v${i}.mp4`
      return { role: 'user' as const, content: `![[v${i}.mp4]]` }
    })
    const out = await withPictures(messages, deps(files))
    expect(out[0]!.content).toBe('[video v0.mp4: sent earlier]')
    expect(out.filter((m) => m.images !== undefined)).toHaveLength(MAX_VIDEOS)
    // Two videos at most, with the pictures, stay under the 100 pictures Claude takes at once.
    expect(MAX_VIDEOS * FRAMES_PER_VIDEO + MAX_PICTURES).toBeLessThanOrEqual(100)
  })

  it('times as a person reads them, to the tenth in a short video', () => {
    expect([clock(5), clock(84), clock(3723)]).toEqual(['0:05', '1:24', '1:02:03'])
    expect([clock(1.375, true), clock(0.125, true)]).toEqual(['0:01.3', '0:00.1'])
  })

  it('a short clip’s many frames: which pictures, how often, from when to when', () => {
    const ats = Array.from({ length: 12 }, (_, i) => (3 * (i + 0.5)) / 12)
    expect(framesSaid('clip.mov', 3, ats, 1)).toBe(
      '[video: clip.mov, 0:03.0 long - sent as 12 frames in order (pictures 1-12), one every 0.25 s from 0:00.1 to 0:02.8; together they show what happens in it]',
    )
  })

  it('whether the question itself has a picture', () => {
    expect(asksWithPicture([{ role: 'user', content: '![[a.png]]' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'and?' }])).toBe(false)
    expect(asksWithPicture([{ role: 'user', content: 'this ![[a.png]]' }])).toBe(true)
    expect(asksWithPicture([{ role: 'user', content: 'this ![[a.mp4]]' }])).toBe(true)
  })
})
