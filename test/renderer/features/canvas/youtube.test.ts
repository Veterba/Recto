import { describe, expect, it } from 'vitest'
import { vimeoId, youTubeId } from '../../../../src/shared/youtube'

describe('YouTube links', () => {
  it('finds the video in watch, short, shorts and embed links', () => {
    expect(youTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=3')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://m.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('is null for anything else', () => {
    expect(youTubeId('https://example.org/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youTubeId('https://www.youtube.com/channel/abc')).toBeNull()
  })
})

describe('Vimeo links', () => {
  it('finds the video in a page link and a player link', () => {
    expect(vimeoId('https://vimeo.com/76979871')).toBe('76979871')
    expect(vimeoId('https://vimeo.com/76979871?share=copy')).toBe('76979871')
    expect(vimeoId('https://player.vimeo.com/video/76979871')).toBe('76979871')
  })
  it('is null for a channel, a person or another site', () => {
    expect(vimeoId('https://vimeo.com/channels/staffpicks')).toBeNull()
    expect(vimeoId('https://vimeo.com/user123')).toBeNull()
    expect(vimeoId('https://example.org/76979871')).toBeNull()
  })
})
