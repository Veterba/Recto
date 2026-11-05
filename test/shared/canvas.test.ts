import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CanvasParseError,
  canvasFiles,
  edgeEnds,
  newCanvasId,
  parseCanvas,
  patchNode,
  renameInCanvas,
  serializeCanvas,
} from '../../src/shared/canvas'

/**
 * JSON Canvas read and written without losing anything: a file Obsidian
 * wrote comes back byte for byte, keys and node types Recto does not know
 * stay where they were, and a change is a change of one line.
 */

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, '../fixtures/canvas', name), 'utf8')

describe('JSON Canvas', () => {
  it('round-trips a file written the way Obsidian writes it, byte for byte', () => {
    const text = fixture('garden.canvas')
    expect(serializeCanvas(parseCanvas(text))).toBe(text)
  })

  it('keeps keys, node types and top-level data it does not know', () => {
    const doc = parseCanvas(fixture('garden.canvas'))
    expect(doc.nodes.find((n) => n.id === '1234abcd5678ef90')?.['styleAttributes']).toEqual({ shape: 'pill' })
    expect(doc.nodes.find((n) => n.id === 'feedfacecafebeef')).toMatchObject({ type: 'excalidraw', drawing: 'abc' })
    expect(doc.rest['metadata']).toEqual({ version: '1.0-1.0', frontmatter: {} })
    expect(serializeCanvas(doc)).toContain('"metadata":{"version":"1.0-1.0","frontmatter":{}}')
  })

  it('a moved node changes its own line and nothing else, its keys in their order', () => {
    const text = fixture('garden.canvas')
    const doc = parseCanvas(text)
    const nodes = doc.nodes.map((n) => (n.id === '1234abcd5678ef90' ? patchNode(n, { x: 240.6, y: 10 }) : n))
    const after = serializeCanvas({ ...doc, nodes }).split('\n')
    const before = text.split('\n')
    const changed = after.filter((line, i) => line !== before[i])
    expect(changed).toEqual(['\t\t{"id":"1234abcd5678ef90","type":"text","text":"Plugin node","x":241,"y":10,"width":200,"height":80,"styleAttributes":{"shape":"pill"}},'])
    expect(after).toHaveLength(before.length)
  })

  it('removes a key on undefined and adds a new one at the end', () => {
    const node = parseCanvas(fixture('garden.canvas')).nodes[2]!
    expect(Object.keys(patchNode(node, { color: undefined, subpath: '#Mix' }))).toEqual(['id', 'type', 'file', 'x', 'y', 'width', 'height', 'subpath'])
  })

  it('reads the spec’s edge defaults, empty files and broken ones', () => {
    const doc = parseCanvas(fixture('garden.canvas'))
    expect(edgeEnds(doc.edges[0]!)).toEqual({ from: 'none', to: 'arrow' })
    expect(edgeEnds(doc.edges[1]!)).toEqual({ from: 'none', to: 'none' })
    expect(parseCanvas('')).toMatchObject({ nodes: [], edges: [] })
    expect(serializeCanvas(parseCanvas(''))).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}')
    expect(() => parseCanvas('{"nodes":[{"id":"a","type":"text"}]}')).toThrow(CanvasParseError)
    expect(() => parseCanvas('{nope')).toThrow(CanvasParseError)
  })

  it('lists its files and follows a renamed note or folder', () => {
    const doc = parseCanvas(fixture('garden.canvas'))
    expect(canvasFiles(doc).map((f) => f.file)).toEqual(['Garden/Soil.md', 'attachments/beds.png'])
    expect(renameInCanvas(doc, 'Garden/Soil.md', 'Garden/Soil mix.md')?.nodes[2]?.file).toBe('Garden/Soil mix.md')
    expect(renameInCanvas(doc, 'Garden', 'Yard')?.nodes[2]?.file).toBe('Yard/Soil.md')
    expect(renameInCanvas(doc, 'Kitchen/Bread.md', 'x.md')).toBeNull()
  })

  it('makes 16-hex ids the canvas does not use yet', () => {
    const doc = parseCanvas(fixture('garden.canvas'))
    const id = newCanvasId(doc)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(doc.nodes.some((n) => n.id === id)).toBe(false)
  })
})
