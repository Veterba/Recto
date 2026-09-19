import { DEFAULT_LOOK } from '../src/renderer/graph/look'
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
    const saved = {
      tunables: { ...DEFAULT_TUNABLES, repelStrength: 400 },
      showLabels: false,
      showOrphans: false,
      showTasks: true,
      showChats: true,
      look: { ...DEFAULT_LOOK, dots: { ...DEFAULT_LOOK.dots, colors: ['#22d3ee', '#f0abfc'] } },
      layout: { mode: 'tree' as const, direction: 'right' as const, spacing: 1.5 },
      linkRange: { min: 2, max: 16 },
      localOnly: true,
    }
    expect(parseSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })

  it('hides task cards unless the file says otherwise', () => {
    // They live in a folder the Data tree hides, and a note visible in one list
    // and not the other reads as a ghost the app failed to forget.
    expect(parseSettings({}).showTasks).toBe(false)
    expect(parseSettings({ showTasks: true }).showTasks).toBe(true)
    expect(parseSettings({ showTasks: 'yes' }).showTasks).toBe(false)
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
    expect(Object.keys(parsed).sort()).toEqual(['layout', 'linkRange', 'localOnly', 'look', 'showChats', 'showLabels', 'showOrphans', 'showTasks', 'tunables'])
  })

  it('does not mutate the shared defaults', () => {
    parseSettings({ tunables: { repelStrength: 77 } })
    expect(DEFAULT_TUNABLES.repelStrength).toBe(2400)
  })
})

describe('showChats', () => {
  it('shows chats unless told otherwise', () => {
    expect(parseSettings({}).showChats).toBe(true)
    expect(parseSettings({ showChats: false }).showChats).toBe(false)
    expect(parseSettings({ showChats: 'no' }).showChats).toBe(true)
  })
})

describe('forces', () => {
  it('starts the graph on the dialled-in defaults', () => {
    expect(parseSettings({}).tunables).toEqual(DEFAULT_TUNABLES)
  })

  it('keeps the unlinked tether inside its range', () => {
    // 0 is a graph whose unlinked notes drift off the canvas and cannot be
    // brought back from a view that no longer shows them.
    expect(parseSettings({ tunables: { orphanPull: 0.2 } }).tunables.orphanPull).toBe(0.2)
    expect(parseSettings({ tunables: { orphanPull: 40 } }).tunables.orphanPull).toBe(1)
    expect(parseSettings({ tunables: { orphanPull: -1 } }).tunables.orphanPull).toBe(0)
    expect(parseSettings({ tunables: { orphanPull: 'far' } }).tunables.orphanPull).toBe(DEFAULT_TUNABLES.orphanPull)
  })

  it('reads a file the per-layout build wrote, keeping the organic set', () => {
    // One build kept a set of forces per layout; its file is a map, not a set.
    const parsed = parseSettings({
      tunables: { organic: { repelStrength: 900, linkDistance: 40 }, tree: { repelStrength: 150 } },
    })
    expect(parsed.tunables.repelStrength).toBe(900)
    expect(parsed.tunables.linkDistance).toBe(40)
    expect(parsed.tunables.linkStrength).toBe(DEFAULT_TUNABLES.linkStrength)
  })
})
