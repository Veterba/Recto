import { describe, expect, it } from 'vitest'
import { youTubeId } from '../../../../src/shared/youtube'

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
