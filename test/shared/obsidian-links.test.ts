import { describe, expect, it } from 'vitest'
import {
  formatLink,
  rewriteForRename,
  linkVault,
  nameProblem,
  nameWarnings,
  resolveLinkpath,
  settingsFromAppJson,
  splitSubpath,
  takenInFolder,
  type LinkFile,
} from '../../src/shared/obsidian-links'

/**
 * Obsidian's link rules, measured in Obsidian 1.15.0 on the test vault ~/Recto-test-vaults/obsidian-links
 * (docs/dev/obsidian-link-rules.md). Each expectation here is what Obsidian itself answered:
 * getFirstLinkpathDest for reading, generateMarkdownLink for writing, vault.create for names.
 * Files are listed in the order Obsidian's index had them; `ctime` stands for that order.
 */

import { FILES, RESOLVE_ROWS as rows } from '../fixtures/obsidian-links-measured'
const vault = linkVault(FILES)

describe('reading a link, as Obsidian resolves it (measured)', () => {
  it.each(rows)('from %s, %s → %s', (source, link, expected) => {
    expect(resolveLinkpath(splitSubpath(link).path, source, vault)).toBe(expected)
  })
})

describe('which same-named file wins (measured)', () => {
  const at = (paths: string[]) => linkVault(paths.map((path, ctime) => ({ path, ctime })))
  it('same depth: the one Obsidian made first (T2/Tie.md)', () => {
    const v = at(['Source root.md', 'C/Source C.md', 'T2/Tie.md', 'T3/Tie.md', 'T1/Tie.md'])
    expect(resolveLinkpath('Tie', 'Source root.md', v)).toBe('T2/Tie.md')
    expect(resolveLinkpath('Tie', 'C/Source C.md', v)).toBe('T2/Tie.md')
  })
  it('a shorter path wins over one made earlier (Q/Len2.md)', () => {
    const v = at(['Source root.md', 'LONGFOLDER/deeper/Len2.md', 'Q/Len2.md'])
    expect(resolveLinkpath('Len2', 'Source root.md', v)).toBe('Q/Len2.md')
  })
  it("in the linking note's folder or below wins over a shorter one elsewhere (C/zz/Sub.md)", () => {
    const v = at(['Source root.md', 'B/Source B.md', 'C/Source C.md', 'Q/Sub.md', 'C/zz/Sub.md'])
    expect(resolveLinkpath('Sub', 'C/Source C.md', v)).toBe('C/zz/Sub.md')
    expect(resolveLinkpath('Sub', 'Source root.md', v)).toBe('Q/Sub.md')
    expect(resolveLinkpath('Sub', 'B/Source B.md', v)).toBe('Q/Sub.md')
  })
  it('shorter in characters, not in folders (X/Y/L4.md)', () => {
    const v = at(['Source root.md', 'AAAAAAAA/Len3.md', 'B/Len3.md', 'AAAAAAAA/L4.md', 'X/Y/L4.md'])
    expect(resolveLinkpath('Len3', 'Source root.md', v)).toBe('B/Len3.md')
    expect(resolveLinkpath('L4', 'Source root.md', v)).toBe('X/Y/L4.md')
  })
  it('a new same-named file at the top takes a bare link from everywhere (check c)', () => {
    const v = linkVault([...FILES, { path: 'Idea.md', ctime: 99 }])
    expect(resolveLinkpath('Idea', 'Source root.md', v)).toBe('Idea.md')
    expect(resolveLinkpath('Idea', 'A/Source A.md', v)).toBe('Idea.md')
    expect(resolveLinkpath('Idea', 'B/Source B.md', v)).toBe('Idea.md')
    expect(resolveLinkpath('Idea', 'A/sub/Source A-sub.md', v)).toBe('Idea.md')
    expect(resolveLinkpath('Idea', 'C/Source C.md', v)).toBe('Idea.md')
  })
})

describe('writing a link, as Obsidian writes it (measured)', () => {
  const rows: [string, 'shortest' | 'relative' | 'absolute', boolean, string, string, string | undefined, string | undefined, string][] = [
    ['C/Note -> A/Plan', 'shortest', false, 'A/Plan.md', 'C/Note.md', undefined, undefined, '[[A/Plan]]'],
    ['A/sub -> A/sub/Plan (sibling)', 'shortest', false, 'A/sub/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[[A/sub/Plan]]'],
    ['A/sub -> A/Plan (parent)', 'shortest', false, 'A/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[[A/Plan]]'],
    ['C/Note -> Source B (unique name)', 'shortest', false, 'B/Source B.md', 'C/Note.md', undefined, undefined, '[[Source B]]'],
    ['C/Note -> root Plan', 'shortest', false, 'Plan.md', 'C/Note.md', undefined, undefined, '[[Plan]]'],
    ['C/Note -> B/Idea', 'shortest', false, 'B/Idea.md', 'C/Note.md', undefined, undefined, '[[B/Idea]]'],
    ['C/Note -> C/deep/Idea', 'shortest', false, 'C/deep/Idea.md', 'C/Note.md', undefined, undefined, '[[C/deep/Idea]]'],
    ['root -> A/Image.png', 'shortest', false, 'A/Image.png', 'Source root.md', undefined, undefined, '[[A/Image.png]]'],
    [
      'C/Note -> A/sub/Plan #Heading |alias',
      'shortest',
      false,
      'A/sub/Plan.md',
      'C/Note.md',
      '#Heading',
      'alias',
      '[[A/sub/Plan#Heading|alias]]',
    ],
    ['C/Note -> A/Plan', 'shortest', true, 'A/Plan.md', 'C/Note.md', undefined, undefined, '[Plan](A/Plan.md)'],
    [
      'A/sub -> A/sub/Plan (sibling)',
      'shortest',
      true,
      'A/sub/Plan.md',
      'A/sub/Source A-sub.md',
      undefined,
      undefined,
      '[Plan](A/sub/Plan.md)',
    ],
    ['A/sub -> A/Plan (parent)', 'shortest', true, 'A/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[Plan](A/Plan.md)'],
    ['C/Note -> Source B (unique name)', 'shortest', true, 'B/Source B.md', 'C/Note.md', undefined, undefined, '[Source B](Source%20B.md)'],
    ['C/Note -> root Plan', 'shortest', true, 'Plan.md', 'C/Note.md', undefined, undefined, '[Plan](Plan.md)'],
    ['C/Note -> B/Idea', 'shortest', true, 'B/Idea.md', 'C/Note.md', undefined, undefined, '[Idea](B/Idea.md)'],
    ['C/Note -> C/deep/Idea', 'shortest', true, 'C/deep/Idea.md', 'C/Note.md', undefined, undefined, '[Idea](C/deep/Idea.md)'],
    ['root -> A/Image.png', 'shortest', true, 'A/Image.png', 'Source root.md', undefined, undefined, '[](A/Image.png)'],
    [
      'C/Note -> A/sub/Plan #Heading |alias',
      'shortest',
      true,
      'A/sub/Plan.md',
      'C/Note.md',
      '#Heading',
      'alias',
      '[alias](A/sub/Plan.md#Heading)',
    ],
    ['C/Note -> A/Plan', 'relative', false, 'A/Plan.md', 'C/Note.md', undefined, undefined, '[[../A/Plan]]'],
    ['A/sub -> A/sub/Plan (sibling)', 'relative', false, 'A/sub/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[[Plan]]'],
    ['A/sub -> A/Plan (parent)', 'relative', false, 'A/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[[../Plan]]'],
    ['C/Note -> Source B (unique name)', 'relative', false, 'B/Source B.md', 'C/Note.md', undefined, undefined, '[[../B/Source B]]'],
    ['C/Note -> root Plan', 'relative', false, 'Plan.md', 'C/Note.md', undefined, undefined, '[[../Plan]]'],
    ['C/Note -> B/Idea', 'relative', false, 'B/Idea.md', 'C/Note.md', undefined, undefined, '[[../B/Idea]]'],
    ['C/Note -> C/deep/Idea', 'relative', false, 'C/deep/Idea.md', 'C/Note.md', undefined, undefined, '[[deep/Idea]]'],
    ['root -> A/Image.png', 'relative', false, 'A/Image.png', 'Source root.md', undefined, undefined, '[[A/Image.png]]'],
    [
      'C/Note -> A/sub/Plan #Heading |alias',
      'relative',
      false,
      'A/sub/Plan.md',
      'C/Note.md',
      '#Heading',
      'alias',
      '[[../A/sub/Plan#Heading|alias]]',
    ],
    ['C/Note -> A/Plan', 'relative', true, 'A/Plan.md', 'C/Note.md', undefined, undefined, '[Plan](../A/Plan.md)'],
    ['A/sub -> A/sub/Plan (sibling)', 'relative', true, 'A/sub/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[Plan](Plan.md)'],
    ['A/sub -> A/Plan (parent)', 'relative', true, 'A/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[Plan](../Plan.md)'],
    [
      'C/Note -> Source B (unique name)',
      'relative',
      true,
      'B/Source B.md',
      'C/Note.md',
      undefined,
      undefined,
      '[Source B](../B/Source%20B.md)',
    ],
    ['C/Note -> root Plan', 'relative', true, 'Plan.md', 'C/Note.md', undefined, undefined, '[Plan](../Plan.md)'],
    ['C/Note -> B/Idea', 'relative', true, 'B/Idea.md', 'C/Note.md', undefined, undefined, '[Idea](../B/Idea.md)'],
    ['C/Note -> C/deep/Idea', 'relative', true, 'C/deep/Idea.md', 'C/Note.md', undefined, undefined, '[Idea](deep/Idea.md)'],
    ['root -> A/Image.png', 'relative', true, 'A/Image.png', 'Source root.md', undefined, undefined, '[](A/Image.png)'],
    [
      'C/Note -> A/sub/Plan #Heading |alias',
      'relative',
      true,
      'A/sub/Plan.md',
      'C/Note.md',
      '#Heading',
      'alias',
      '[alias](../A/sub/Plan.md#Heading)',
    ],
    ['C/Note -> A/Plan', 'absolute', false, 'A/Plan.md', 'C/Note.md', undefined, undefined, '[[A/Plan]]'],
    ['A/sub -> A/sub/Plan (sibling)', 'absolute', false, 'A/sub/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[[A/sub/Plan]]'],
    ['A/sub -> A/Plan (parent)', 'absolute', false, 'A/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[[A/Plan]]'],
    ['C/Note -> Source B (unique name)', 'absolute', false, 'B/Source B.md', 'C/Note.md', undefined, undefined, '[[B/Source B]]'],
    ['C/Note -> root Plan', 'absolute', false, 'Plan.md', 'C/Note.md', undefined, undefined, '[[Plan]]'],
    ['C/Note -> B/Idea', 'absolute', false, 'B/Idea.md', 'C/Note.md', undefined, undefined, '[[B/Idea]]'],
    ['C/Note -> C/deep/Idea', 'absolute', false, 'C/deep/Idea.md', 'C/Note.md', undefined, undefined, '[[C/deep/Idea]]'],
    ['root -> A/Image.png', 'absolute', false, 'A/Image.png', 'Source root.md', undefined, undefined, '[[A/Image.png]]'],
    [
      'C/Note -> A/sub/Plan #Heading |alias',
      'absolute',
      false,
      'A/sub/Plan.md',
      'C/Note.md',
      '#Heading',
      'alias',
      '[[A/sub/Plan#Heading|alias]]',
    ],
    ['C/Note -> A/Plan', 'absolute', true, 'A/Plan.md', 'C/Note.md', undefined, undefined, '[Plan](A/Plan.md)'],
    [
      'A/sub -> A/sub/Plan (sibling)',
      'absolute',
      true,
      'A/sub/Plan.md',
      'A/sub/Source A-sub.md',
      undefined,
      undefined,
      '[Plan](A/sub/Plan.md)',
    ],
    ['A/sub -> A/Plan (parent)', 'absolute', true, 'A/Plan.md', 'A/sub/Source A-sub.md', undefined, undefined, '[Plan](A/Plan.md)'],
    [
      'C/Note -> Source B (unique name)',
      'absolute',
      true,
      'B/Source B.md',
      'C/Note.md',
      undefined,
      undefined,
      '[Source B](B/Source%20B.md)',
    ],
    ['C/Note -> root Plan', 'absolute', true, 'Plan.md', 'C/Note.md', undefined, undefined, '[Plan](Plan.md)'],
    ['C/Note -> B/Idea', 'absolute', true, 'B/Idea.md', 'C/Note.md', undefined, undefined, '[Idea](B/Idea.md)'],
    ['C/Note -> C/deep/Idea', 'absolute', true, 'C/deep/Idea.md', 'C/Note.md', undefined, undefined, '[Idea](C/deep/Idea.md)'],
    ['root -> A/Image.png', 'absolute', true, 'A/Image.png', 'Source root.md', undefined, undefined, '[](A/Image.png)'],
    [
      'C/Note -> A/sub/Plan #Heading |alias',
      'absolute',
      true,
      'A/sub/Plan.md',
      'C/Note.md',
      '#Heading',
      'alias',
      '[alias](A/sub/Plan.md#Heading)',
    ],
  ]
  it.each(rows)('%s, %s, markdown %s', (_label, newLinkFormat, useMarkdownLinks, to, from, subpath, alias, expected) => {
    expect(
      formatLink(
        to,
        from,
        vault,
        { newLinkFormat, useMarkdownLinks },
        { ...(subpath === undefined ? {} : { subpath }), ...(alias === undefined ? {} : { alias }) },
      ),
    ).toBe(expected)
  })
})

describe('names, as Obsidian allows them (measured)', () => {
  it('allows *', () => {
    expect(nameProblem('Bad * name') === null).toBe(true)
  })
  it('allows "', () => {
    expect(nameProblem('Bad " name') === null).toBe(true)
  })
  it('refuses \\', () => {
    expect(nameProblem('Bad \\ name') === null).toBe(false)
  })
  it('refuses /', () => {
    expect(nameProblem('Bad / name') === null).toBe(false)
  })
  it('allows <', () => {
    expect(nameProblem('Bad < name') === null).toBe(true)
  })
  it('allows >', () => {
    expect(nameProblem('Bad > name') === null).toBe(true)
  })
  it('refuses :', () => {
    expect(nameProblem('Bad : name') === null).toBe(false)
  })
  it('allows |', () => {
    expect(nameProblem('Bad | name') === null).toBe(true)
  })
  it('allows ?', () => {
    expect(nameProblem('Bad ? name') === null).toBe(true)
  })
  it('allows #', () => {
    expect(nameProblem('Bad # name') === null).toBe(true)
  })
  it('allows ^', () => {
    expect(nameProblem('Bad ^ name') === null).toBe(true)
  })
  it('allows [', () => {
    expect(nameProblem('Bad [ name') === null).toBe(true)
  })
  it('allows ]', () => {
    expect(nameProblem('Bad ] name') === null).toBe(true)
  })
  it('two names that differ only in case are the same file in a folder (plan.md beside Plan.md: refused)', () => {
    expect(takenInFolder('', 'plan.md', ['Plan.md', 'A/Plan.md'])).toBe('Plan.md')
    expect(takenInFolder('C', 'Plan.md', ['Plan.md', 'A/Plan.md'])).toBeNull()
  })
})

describe('settings from .obsidian/app.json', () => {
  it("reads the three, Obsidian's defaults where it says nothing", () => {
    expect(settingsFromAppJson(null)).toEqual({ newLinkFormat: 'shortest', useMarkdownLinks: false, alwaysUpdateLinks: false })
    expect(settingsFromAppJson('{"newLinkFormat":"relative","useMarkdownLinks":true,"alwaysUpdateLinks":true}')).toEqual({
      newLinkFormat: 'relative',
      useMarkdownLinks: true,
      alwaysUpdateLinks: true,
    })
    expect(settingsFromAppJson('not json')).toEqual({ newLinkFormat: 'shortest', useMarkdownLinks: false, alwaysUpdateLinks: false })
  })
})

describe('renaming and moving, as Obsidian updates links (measured)', () => {
  const SOURCES = ['Source root.md', 'A/Source A.md', 'B/Source B.md', 'A/sub/Source A-sub.md', 'C/Source C.md']
  const ORIGINAL =
    '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[A/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](../A/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[a/plan]]\n19. [[A/Plan.md]]\n20. [[B/Plan|alias B]]\n21. [[B/Plan#Heading]]\n22. ![[B/Plan]]\n23. [B plan](B/Plan.md)'
  // Check c made a top-level Idea.md before the renames.
  const withIdea = [...FILES, { path: 'Idea.md', ctime: 99 }]
  const renamed = (files: LinkFile[], from: string, to: string): LinkFile[] => files.map((f) => (f.path === from ? { ...f, path: to } : f))
  const b1Before = linkVault(withIdea)
  const b1Files = renamed(withIdea, 'B/Plan.md', 'B/Plan 2.md')
  const b1After = linkVault(b1Files)
  const b2After = linkVault(renamed(b1Files, 'A/Plan.md', 'C/deep/Plan.md'))
  const expected: Record<'b1' | 'b2', Record<string, string>> = {
    b1: {
      'Source root.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[A/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](../A/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[a/plan]]\n19. [[A/Plan.md]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'A/Source A.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[A/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](../A/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[a/plan]]\n19. [[A/Plan.md]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'B/Source B.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[A/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](../A/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[Plan 2]]\n18. [[a/plan]]\n19. [[A/Plan.md]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'A/sub/Source A-sub.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[A/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](../A/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[a/plan]]\n19. [[A/Plan.md]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'C/Source C.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[A/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](../A/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[a/plan]]\n19. [[A/Plan.md]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
    },
    b2: {
      'Source root.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[C/deep/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](C/deep/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[C/deep/Plan]]\n19. [[C/deep/Plan]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'A/Source A.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[C/deep/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](C/deep/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[C/deep/Plan]]\n18. [[C/deep/Plan]]\n19. [[C/deep/Plan]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'B/Source B.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[C/deep/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](C/deep/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[Plan 2]]\n18. [[C/deep/Plan]]\n19. [[C/deep/Plan]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'A/sub/Source A-sub.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[C/deep/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](../A/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[C/deep/Plan]]\n19. [[C/deep/Plan]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
      'C/Source C.md':
        '1. [[Plan]]\n2. [[plan]]\n3. [[Plan|alias]]\n4. [[Plan#Heading]]\n5. [[Plan.md]]\n6. [[C/deep/Plan]]\n7. [[sub/Plan]]\n8. [[A/sub/Plan]]\n9. ![[Plan]]\n10. ![[Image.png]]\n11. [[Image.png]]\n12. [Plan](Plan.md)\n13. [Plan](C/deep/Plan.md)\n14. [[Missing]]\n15. [[Idea]]\n16. [[/Plan]]\n17. [[./Plan]]\n18. [[C/deep/Plan]]\n19. [[C/deep/Plan]]\n20. [[Plan 2|alias B]]\n21. [[Plan 2#Heading]]\n22. ![[Plan 2]]\n23. [B plan](Plan%202.md)',
    },
  }
  it.each(SOURCES)('B/Plan → B/Plan 2: links in %s', (source) => {
    const out = rewriteForRename(ORIGINAL, { before: source, after: source }, new Map([['B/Plan.md', 'B/Plan 2.md']]), b1Before, b1After, { newLinkFormat: 'shortest' })
    expect(out.text).toBe(expected.b1[source])
  })
  it.each(SOURCES)('then A/Plan → C/deep/Plan: links in %s', (source) => {
    const first = rewriteForRename(ORIGINAL, { before: source, after: source }, new Map([['B/Plan.md', 'B/Plan 2.md']]), b1Before, b1After, { newLinkFormat: 'shortest' }).text
    const out = rewriteForRename(first, { before: source, after: source }, new Map([['A/Plan.md', 'C/deep/Plan.md']]), b1After, b2After, { newLinkFormat: 'shortest' })
    expect(out.text).toBe(expected.b2[source])
  })
})

describe('rewrite after a move: beyond the measured table', () => {
  const at = (paths: string[]) => linkVault(paths.map((path, ctime) => ({ path, ctime })))
  const shortest = { newLinkFormat: 'shortest' } as const

  it('leaves links in fenced code as they are, and keeps CRLF line endings', () => {
    const before = at(['A/Plan.md', 'Note.md'])
    const after = at(['A/Plan 2.md', 'Note.md'])
    const text = '[[Plan]]\r\n```\r\n[[Plan]]\r\n```\r\n[[Plan|p]]\r\n'
    const out = rewriteForRename(text, { before: 'Note.md', after: 'Note.md' }, new Map([['A/Plan.md', 'A/Plan 2.md']]), before, after, shortest)
    expect(out.text).toBe('[[Plan 2]]\r\n```\r\n[[Plan]]\r\n```\r\n[[Plan 2|p]]\r\n')
    expect(out.changed).toBe(2)
  })

  it('a moved note’s own relative link still means the same file', () => {
    const before = at(['A/Note.md', 'B/Other.md'])
    const after = at(['A/deep/Note.md', 'B/Other.md'])
    const out = rewriteForRename(
      '[[../B/Other]] and [[Other]]',
      { before: 'A/Note.md', after: 'A/deep/Note.md' },
      new Map([['A/Note.md', 'A/deep/Note.md']]),
      before,
      after,
      shortest,
    )
    // The bare name still finds it; the relative one is written again, in the vault's format.
    expect(out.text).toBe('[[Other]] and [[Other]]')
  })

  it('a folder renamed: links to every file in it follow, in one pass', () => {
    const before = at(['A/Plan.md', 'A/Idea.md', 'B/Plan.md', 'Note.md'])
    const after = at(['Z/Plan.md', 'Z/Idea.md', 'B/Plan.md', 'Note.md'])
    const moves = new Map([
      ['A/Plan.md', 'Z/Plan.md'],
      ['A/Idea.md', 'Z/Idea.md'],
    ])
    const out = rewriteForRename('[[A/Plan]] [[B/Plan]] [[Idea]]', { before: 'Note.md', after: 'Note.md' }, moves, before, after, shortest)
    expect(out.text).toBe('[[Z/Plan]] [[B/Plan]] [[Idea]]')
  })
})

describe('names: warned, never refused or changed', () => {
  it('a name links cannot find, Windows cannot hold, or that hides the file', () => {
    expect(nameWarnings('Plan')).toEqual([])
    expect(nameWarnings('Plan #2')).toEqual(['Links will not work with file names containing any of these characters: # ^ [ ] |'])
    expect(nameWarnings('What?')).toEqual(['This name will not work on Windows: it has one of * " < > ? | or ends in a dot or a space.'])
    expect(nameWarnings('a|b')).toHaveLength(2)
    expect(nameWarnings('Notes.')).toHaveLength(1)
    expect(nameWarnings('Notes ')).toHaveLength(1)
    expect(nameWarnings('.hidden')).toEqual(['A name starting with “.” is hidden, here and in Obsidian.'])
    // Still allowed: only \ / : are refused.
    for (const name of ['Plan #2', 'What?', 'a|b', '.hidden']) expect(nameProblem(name)).toBeNull()
  })
})

describe('writing a link to a file not made yet', () => {
  it('is its path when another file has the name, and its name when none does', () => {
    const v = linkVault([{ path: 'Old/2026-W42.md', ctime: 0 }])
    const shortest = { newLinkFormat: 'shortest', useMarkdownLinks: false } as const
    expect(formatLink('Journal/2026/2026-W42.md', 'Journal/2026/10/2026-10-16.md', v, shortest)).toBe('[[Journal/2026/2026-W42]]')
    expect(formatLink('Journal/2026/2026-W43.md', 'Journal/2026/10/2026-10-23.md', v, shortest)).toBe('[[2026-W43]]')
  })
})

describe('reading a link: case and Unicode form', () => {
  it('a name typed in another Unicode form or case is the same note', () => {
    const v = linkVault([{ path: 'Заметки/день.md', ctime: 0 }, { path: 'Notes/Café.md'.normalize('NFD'), ctime: 1 }])
    expect(resolveLinkpath('ДЕНЬ', '', v)).toBe('Заметки/день.md')
    expect(resolveLinkpath('Café'.normalize('NFC'), '', v)).toBe('Notes/Café.md'.normalize('NFD'))
    expect(resolveLinkpath('does-not-exist', '', v)).toBeNull()
  })
})
