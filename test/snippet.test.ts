import { describe, expect, it } from 'vitest'
import { plainSnippet } from '../src/renderer/core/snippet'

describe('plainSnippet', () => {
  it('keeps the words and drops the syntax', () => {
    expect(plainSnippet('# Contrastive Learning\nNotes on contrastive learning.\n## Related\n- [[Batch Normalization]]')).toBe(
      'Contrastive Learning Notes on contrastive learning. Related Batch Normalization',
    )
  })

  it('shows the half of a link a reader would have read', () => {
    expect(plainSnippet('see [[notes/Deep Learning|the book]] and [[Vectors#Basis]]')).toBe('see the book and Vectors')
    expect(plainSnippet('a [link](https://example.com) and ![shot](img.png)')).toBe('a link and shot')
  })

  it('unwraps emphasis, code and checkboxes', () => {
    expect(plainSnippet('**bold** and _thin_ and `code`')).toBe('bold and thin and code')
    expect(plainSnippet('- [ ] a task\n- [x] a done one')).toBe('a task a done one')
  })

  it('leaves the match markers alone, wherever they sit', () => {
    expect(plainSnippet('…on [[Batch <<Normalization>>]] and **<<bold>>**…')).toBe('…on Batch <<Normalization>> and <<bold>>…')
  })

  it('does not choke on a fragment with unbalanced syntax', () => {
    expect(plainSnippet('…half a **sentence and a [broken](')).toBe('…half a sentence and a [broken](')
  })
})
