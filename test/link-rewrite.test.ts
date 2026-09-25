import { describe, expect, it } from 'vitest'
import { extractTargets, rewriteWikiLinks } from '../src/main/link-rewrite'

const rewrite = (text: string, from: string, to: string): string => rewriteWikiLinks(text, from, to).text

describe('rewriting links on rename', () => {
  it('rewrites a bare-name link', () => {
    expect(rewrite('see [[old]]', 'old.md', 'new.md')).toBe('see [[new]]')
  })

  it('keeps an alias untouched - it is the user\'s words, not a path', () => {
    expect(rewrite('see [[old|the old one]]', 'old.md', 'new.md')).toBe('see [[new|the old one]]')
  })

  it('keeps a heading anchor', () => {
    expect(rewrite('see [[old#Section]]', 'old.md', 'new.md')).toBe('see [[new#Section]]')
  })

  it('keeps both a heading and an alias, in order', () => {
    expect(rewrite('[[old#Sec|Name]]', 'old.md', 'new.md')).toBe('[[new#Sec|Name]]')
  })

  it('preserves an explicit .md suffix only when it was written', () => {
    expect(rewrite('[[old.md]]', 'old.md', 'new.md')).toBe('[[new.md]]')
    expect(rewrite('[[old]]', 'old.md', 'new.md')).toBe('[[new]]')
  })

  it('matches a link written with a path', () => {
    expect(rewrite('[[work/old]]', 'work/old.md', 'work/new.md')).toBe('[[work/new]]')
  })

  it('keeps the same path depth rather than expanding to a full vault path', () => {
    // The link said 'work/old'; it should not become 'a/b/work/new'.
    expect(rewrite('[[work/old]]', 'a/b/work/old.md', 'a/b/work/new.md')).toBe('[[work/new]]')
  })

  it('rewrites a bare name even when the note lives in a folder', () => {
    expect(rewrite('[[old]]', 'deep/folder/old.md', 'deep/folder/new.md')).toBe('[[new]]')
  })

  it('follows a note that moved to a different folder', () => {
    expect(rewrite('[[old]]', 'a/old.md', 'b/renamed.md')).toBe('[[renamed]]')
  })

  it('leaves links to other notes alone', () => {
    const text = 'see [[old]] and [[unrelated]] and [[older]]'
    expect(rewrite(text, 'old.md', 'new.md')).toBe('see [[new]] and [[unrelated]] and [[older]]')
  })

  it('does not match a partial name segment', () => {
    // 'old' must not match 'threshold'.
    expect(rewrite('[[threshold]]', 'old.md', 'new.md')).toBe('[[threshold]]')
  })

  it('is case-insensitive on the target', () => {
    expect(rewrite('[[Old]]', 'old.md', 'new.md')).toBe('[[new]]')
  })

  it('handles unicode names', () => {
    expect(rewrite('[[Заметки/день]]', 'Заметки/день.md', 'Заметки/ночь.md')).toBe('[[Заметки/ночь]]')
  })

  it('rewrites several links on one line and reports the count', () => {
    const result = rewriteWikiLinks('[[old]] then [[old|x]]', 'old.md', 'new.md')
    expect(result.text).toBe('[[new]] then [[new|x]]')
    expect(result.count).toBe(2)
  })

  it('leaves links inside fenced code alone', () => {
    const text = ['[[old]]', '```', '[[old]]', '```', '[[old]]'].join('\n')
    const result = rewriteWikiLinks(text, 'old.md', 'new.md')
    expect(result.text).toBe(['[[new]]', '```', '[[old]]', '```', '[[new]]'].join('\n'))
    expect(result.count).toBe(2)
  })

  it('reports zero and returns the text unchanged when nothing matches', () => {
    const result = rewriteWikiLinks('no links here', 'old.md', 'new.md')
    expect(result.count).toBe(0)
    expect(result.text).toBe('no links here')
  })

  it('preserves CRLF-free line structure exactly', () => {
    const text = 'a\n\n[[old]]\n\nb'
    expect(rewrite(text, 'old.md', 'new.md')).toBe('a\n\n[[new]]\n\nb')
  })
})

describe('extracting link targets', () => {
  it('collects distinct targets, stripping heading and alias', () => {
    expect(extractTargets('[[a]] [[b#h]] [[c|x]] [[a]]').sort()).toEqual(['a', 'b', 'c'])
  })

  it('ignores fenced code', () => {
    expect(extractTargets('[[a]]\n```\n[[b]]\n```')).toEqual(['a'])
  })

  it('returns nothing for a document without links', () => {
    expect(extractTargets('# just text')).toEqual([])
  })
})

describe('markdown links', () => {
  const run = (text: string, from = 'Books/Atomic Habits.md', to = 'Books/Atomic Habits Renamed.md') =>
    rewriteWikiLinks(text, from, to)

  it('follows the note through a [text](path) link', () => {
    expect(run('see [the book](Books/Atomic Habits.md)').text).toBe('see [the book](Books/Atomic Habits Renamed.md)')
  })

  it('keeps the encoding the link was written with', () => {
    expect(run('[a](Books/Atomic%20Habits.md)').text).toBe('[a](Books/Atomic%20Habits%20Renamed.md)')
    expect(run('[a](Atomic Habits)').text).toBe('[a](Atomic Habits Renamed)')
  })

  it('keeps a heading, a title and angle brackets', () => {
    expect(run('[a](<Books/Atomic Habits.md#Chapter 2>)').text).toBe('[a](<Books/Atomic Habits Renamed.md#Chapter 2>)')
    expect(run('[a](Atomic Habits.md "The book")').text).toBe('[a](Atomic Habits Renamed.md "The book")')
  })

  it('leaves the link text, embeds and foreign URLs alone', () => {
    expect(run('[Atomic Habits](Atomic Habits.md)').text).toBe('[Atomic Habits](Atomic Habits Renamed.md)')
    expect(run('![shot](Atomic Habits.md)').text).toBe('![shot](Atomic Habits.md)')
    expect(run('[site](https://example.com/Atomic Habits.md)').text).toBe('[site](https://example.com/Atomic Habits.md)')
  })

  it('counts both kinds together', () => {
    const result = run('[[Atomic Habits]] and [the book](Atomic Habits.md)')
    expect(result.count).toBe(2)
    expect(result.text).toBe('[[Atomic Habits Renamed]] and [the book](Atomic Habits Renamed.md)')
  })

  it('does not touch a fenced block', () => {
    expect(run('```\n[a](Atomic Habits.md)\n```').text).toBe('```\n[a](Atomic Habits.md)\n```')
  })
})

describe('renaming a topic never touches links to real notes (regression)', () => {
  /**
   * The bug: renaming the topic `Python` rewrote every link whose bare name
   * was `Python` - including `[[Python]]`, a link to an ordinary note of that
   * name - because a bare name matches any note's filename. A topic rename is
   * exact: only links that spell out `topics/Python` move.
   */
  const text = [
    '---',
    'topics: ["[[topics/Python]]"]',
    '---',
    'Read [[Python]] and [[Python|the language]] and [[Python#Syntax]].',
    'Also [Python](Python.md) and [the topic](topics/Python.md) and [[topics/Python|topic]].',
  ].join('\n')

  it('rewrites only the topic links', () => {
    const { text: out, count } = rewriteWikiLinks(text, 'topics/Python.md', 'topics/Python 3.md', true)
    expect(count).toBe(3)
    expect(out).toBe(
      [
        '---',
        'topics: ["[[topics/Python 3]]"]',
        '---',
        'Read [[Python]] and [[Python|the language]] and [[Python#Syntax]].',
        'Also [Python](Python.md) and [the topic](topics/Python 3.md) and [[topics/Python 3|topic]].',
      ].join('\n'),
    )
  })

  it('a note rename still follows bare names, as before', () => {
    const { count } = rewriteWikiLinks('See [[Python]].', 'Programming/Python.md', 'Programming/Py.md')
    expect(count).toBe(1)
  })
})
