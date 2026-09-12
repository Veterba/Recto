import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from '../src/renderer/graph/settings'
import { DEFAULT_TUNABLES } from '../src/renderer/graph/protocol'

/**
 * `graph.json` is a file a person is invited to edit. Every one of these cases
 * is a file someone could plausibly save, and none of them may stop the graph
 * from opening.
 */

describe('graph settings', () => {
  it('falls back to defaults for a missing file', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back for a file that is not an object', () => {
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS)
  })

  it('reads a file it wrote itself', () => {
    const saved = { tunables: { ...DEFAULT_TUNABLES, repelStrength: 400 }, showLabels: false, showOrphans: false }
    expect(parseSettings(saved)).toEqual(saved)
  })

  it('keeps the defaults for fields the file omits', () => {
    const parsed = parseSettings({ showLabels: false })
    expect(parsed.showLabels).toBe(false)
    expect(parsed.showOrphans).toBe(true)
    expect(parsed.tunables).toEqual(DEFAULT_TUNABLES)
  })

  it('ignores a tunable of the wrong type rather than taking NaN', () => {
    const parsed = parseSettings({ tunables: { repelStrength: 'lots', linkDistance: 90 } })
    expect(parsed.tunables.repelStrength).toBe(DEFAULT_TUNABLES.repelStrength)
    expect(parsed.tunables.linkDistance).toBe(90)
  })

  it('ignores NaN and Infinity, which JSON.parse will happily hand over as numbers', () => {
    const parsed = parseSettings({ tunables: { repelStrength: Number.NaN, linkDistance: Number.POSITIVE_INFINITY } })
    expect(parsed.tunables.repelStrength).toBe(DEFAULT_TUNABLES.repelStrength)
    expect(parsed.tunables.linkDistance).toBe(DEFAULT_TUNABLES.linkDistance)
  })

  it('clamps a hand-typed value that would make the graph unusable', () => {
    // A repulsion of a billion scatters every node past the edge of the canvas,
    // and there is no way to dial it back from a view you cannot see.
    const parsed = parseSettings({ tunables: { repelStrength: 1e9, linkDistance: -5, linkStrength: 99 } })
    expect(parsed.tunables.repelStrength).toBe(4000)
    expect(parsed.tunables.linkDistance).toBe(1)
    expect(parsed.tunables.linkStrength).toBe(2)
  })

  it('ignores a non-boolean toggle', () => {
    expect(parseSettings({ showLabels: 'yes', showOrphans: 0 })).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores unknown keys instead of carrying them into state', () => {
    const parsed = parseSettings({ showLabels: true, mysteryField: { deep: true } })
    expect(Object.keys(parsed).sort()).toEqual(['showLabels', 'showOrphans', 'tunables'])
  })

  it('does not mutate the shared defaults', () => {
    parseSettings({ tunables: { repelStrength: 77 } })
    expect(DEFAULT_TUNABLES.repelStrength).toBe(220)
  })
})
