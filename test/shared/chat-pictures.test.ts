import { describe, expect, it } from 'vitest'
import { pictureRefs, withoutPictures, withPictureEmbeds } from '../../src/shared/chat-pictures'

describe('pictures in a chat message', () => {
  it('finds both embeds Obsidian writes, in order, a size or a heading after the name left off', () => {
    const text = 'Look ![](attachments/a%20shot.png) and ![[b.jpg|300]] then ![[Note]] and ![[c.webp#x]]'
    expect(pictureRefs(text)).toEqual([
      { raw: '![](attachments/a%20shot.png)', target: 'attachments/a shot.png', kind: 'picture' },
      { raw: '![[b.jpg|300]]', target: 'b.jpg', kind: 'picture' },
      { raw: '![[c.webp#x]]', target: 'c.webp', kind: 'picture' },
    ])
  })

  it('a video is one too, told apart', () => {
    expect(pictureRefs('Watch ![[clip.MOV]] and ![](att/b.mp4)')).toEqual([
      { raw: '![[clip.MOV]]', target: 'clip.MOV', kind: 'video' },
      { raw: '![](att/b.mp4)', target: 'att/b.mp4', kind: 'video' },
    ])
    expect(withoutPictures('Watch\n\n![[clip.mov]]')).toBe('Watch')
  })

  it('a note embedded, a link to a picture, a picture on the web: none is a picture of the vault sent', () => {
    expect(pictureRefs('![[Soil]] [[shot.png]] ![](https://example.org/x.png) [x](y.png)')).toEqual([])
  })

  it('the words without the pictures, and a message with none left exactly as it is', () => {
    expect(withoutPictures('What is this?\n\n![[shot.png]]')).toBe('What is this?')
    expect(withoutPictures('a\n\n\n\nb')).toBe('a\n\n\n\nb')
  })

  it('pictures go after the words, one a line; alone, they are the message', () => {
    expect(withPictureEmbeds(' What is this? ', ['![[a.png]]', '![[b.png]]'])).toBe('What is this?\n\n![[a.png]]\n![[b.png]]')
    expect(withPictureEmbeds('', ['![[a.png]]'])).toBe('![[a.png]]')
    expect(withPictureEmbeds('Hi', [])).toBe('Hi')
  })
})
