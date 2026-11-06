// Writes the demo vault: ~/Recto-demo/vault, invented from start to finish, and
// the same every run. Replaces what is there; touches nothing else.
//
//   node scripts/demo/make-vault.mjs

import fs from 'node:fs'
import path from 'node:path'
import { _electron } from 'playwright'
import { BOARD, DAILY, NOTES, WEEKLY } from './vault-notes.mjs'
import { IMAGES } from './vault-images.mjs'
import { DEMO_NOW, ROOT, VAULT } from './paths.mjs'

const write = (rel, text) => {
  const file = path.join(VAULT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** Each image as a PNG, drawn by a bare hidden Electron window (nothing to install). */
async function renderImages() {
  const app = await _electron.launch({
    args: [
      '-r',
      path.join(ROOT, 'scripts/snapshot-isolate.cjs'),
      path.join(ROOT, 'scripts/snapshot-window.cjs'),
      '--force-device-scale-factor=2',
    ],
    env: { ...process.env, RECTO_URL: 'about:blank' },
  })
  const page = await app.firstWindow()
  for (const [name, { width, height, svg }] of Object.entries(IMAGES)) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`)
    const file = path.join(VAULT, 'attachments', name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await page.locator('svg').screenshot({ path: file })
  }
  await app.close()
}

function isoWeekThursday(key) {
  const [year, week] = key.split('-W').map(Number)
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7)
  monday.setUTCDate(monday.getUTCDate() + 3)
  return monday
}

function weekOf(day) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const first = new Date(jan4)
  first.setUTCDate(jan4.getUTCDate() + 3 - ((jan4.getUTCDay() + 6) % 7))
  return 1 + Math.round((d - first) / (7 * 86_400_000))
}

function writeBoard() {
  const dir = `Recto/Boards/${BOARD.name}`
  const lanes = {}
  const sections = BOARD.lanes.map((lane) => {
    lanes[lane.title] = { color: lane.color }
    const done = lane.title === 'Done'
    const items = lane.cards.map((c) => `- [${done ? 'x' : ' '}] [[${c.name}]]`).join('\n')
    return `## ${lane.title}\n\n${done ? '**Complete**\n' : ''}${items}\n\n`
  })
  for (const card of BOARD.lanes.flatMap((lane) => lane.cards)) {
    const { name, body, ...fields } = card
    const front = Object.entries(fields).map(([k, v]) => `${k}: ${v}`)
    write(`${dir}/${name}.md`, `---\n${front.join('\n')}\n---\n\n${body}`)
  }
  const settings = {
    'kanban-plugin': 'board',
    'metadata-keys': [
      { metadataKey: 'priority', label: 'Priority', shouldHideLabel: false, containsMarkdown: false },
      { metadataKey: 'due', label: 'Due', shouldHideLabel: false, containsMarkdown: false },
    ],
    recto: { lanes },
    'new-note-folder': dir,
  }
  write(
    `${dir}/${BOARD.name}.md`,
    `---\n\nkanban-plugin: board\n\n---\n\n${sections.join('\n')}\n\n%% kanban:settings\n\`\`\`\n${JSON.stringify(settings)}\n\`\`\`\n%%\n`,
  )
}

function writeCanvas() {
  const ids = {}
  const id = (name) => (ids[name] ??= (Object.keys(ids).length + 1).toString(16).padStart(4, '0').repeat(4))
  const folder = 'Sleep and memory'
  const nodes = [
    { id: id('group'), type: 'group', x: -430, y: -300, width: 760, height: 520, color: '5', label: 'What happens overnight' },
    {
      id: id('question'),
      type: 'text',
      text: '### Main question\n\nDoes *when* I sleep change what I remember?',
      x: -800,
      y: -240,
      width: 300,
      height: 170,
    },
    { id: id('slow'), type: 'file', file: `${folder}/Slow-wave sleep.md`, x: -400, y: -250, width: 330, height: 240 },
    { id: id('spindles'), type: 'file', file: `${folder}/Sleep spindles.md`, x: -30, y: -250, width: 330, height: 240 },
    {
      id: id('nest'),
      type: 'text',
      text: 'Spindles nest inside slow oscillations: a three-layer clock.',
      x: -210,
      y: 50,
      width: 320,
      height: 120,
    },
    { id: id('consolidation'), type: 'file', file: `${folder}/Memory consolidation.md`, x: 420, y: -280, width: 340, height: 280 },
    { id: id('stages'), type: 'file', file: 'attachments/sleep-stages-chart.png', x: 420, y: 60, width: 340, height: 213 },
    { id: id('curve'), type: 'file', file: 'attachments/forgetting-curve.png', x: -800, y: 20, width: 300, height: 188 },
    { id: id('idea'), type: 'text', text: 'Review vocabulary before bed, test a week later', x: -180, y: 300, width: 300, height: 110 },
  ]
  const edge = (from, fromSide, to, toSide, label) => ({
    id: id(`${from}-${to}`),
    fromNode: id(from),
    fromSide,
    toNode: id(to),
    toSide,
    ...(label === undefined ? {} : { label }),
  })
  const edges = [
    edge('question', 'right', 'slow', 'left'),
    edge('slow', 'right', 'spindles', 'left', 'times'),
    edge('spindles', 'right', 'consolidation', 'left', 'replay'),
    edge('curve', 'top', 'question', 'bottom', 'why it matters'),
    edge('consolidation', 'bottom', 'stages', 'top'),
  ]
  const line = (o) => `\t\t${JSON.stringify(o)}`
  write(
    'Recto/Canvas/Sleep research map.canvas',
    `{\n\t"nodes":[\n${nodes.map(line).join(',\n')}\n\t],\n\t"edges":[\n${edges.map(line).join(',\n')}\n\t]\n}\n`,
  )
}

function writeSettings() {
  write('.recto/appearance.json', JSON.stringify({ theme: 'light', translucent: true, fontSize: 16 }))
  write('.recto/topics-settings.json', JSON.stringify({ enabled: false }))
  write('.recto/bots-settings.json', JSON.stringify({ enabled: true }))
  write('.recto/link-settings.json', JSON.stringify({ alwaysUpdateLinks: true }))
  const off = { enabled: false, folder: null, template: null }
  const on = { ...off, enabled: true }
  write(
    '.recto/templates.json',
    JSON.stringify({
      folder: 'Template',
      periodic: { folder: 'Daily', groupByMonth: false, daily: on, weekly: on, monthly: off, yearly: off },
    }),
  )
  write(
    '.obsidian/app.json',
    JSON.stringify({ attachmentFolderPath: 'attachments', newLinkFormat: 'shortest', useMarkdownLinks: false }, null, 2),
  )
}

/**
 * The overview's writing history. Recto counts it as you work and files cannot
 * tell it afterwards, so a vault that was never edited would show none: this is
 * part of the invention, from a fixed seed.
 */
function writeHistory() {
  let seed = 2026
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const notes = Object.entries(NOTES).flatMap(([folder, inFolder]) => Object.keys(inFolder).map((name) => `${folder}/${name}.md`))
  const days = {}
  const written = {}
  for (let back = 181; back >= 0; back--) {
    const day = new Date(DEMO_NOW.getTime() - back * 86_400_000).toLocaleDateString('sv')
    if (back > 13 && random() > 0.62) continue
    const count = 1 + Math.floor(random() * 4)
    days[day] = Array.from({ length: count }, () => notes[Math.floor(random() * notes.length)])
    written[day] = Object.fromEntries(days[day].map((note) => [note, { notes: 20 + Math.floor(random() * 160) }]))
  }
  const first = Object.keys(days)[0]
  write(
    '.recto/stats/edits.json',
    JSON.stringify({ since: first, backfilled: true, days, written, writtenSince: first, writtenBackfilled: true, writtenFormat: 2 }),
  )
}

/** File dates spread over the last months, by position, so the overview has a history that never changes. */
function setDates() {
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(VAULT)
  const today = '2026-11-06'
  files.forEach((file, i) => {
    const day = /(\d{4}-\d{2}-\d{2})\.md$/.exec(file)?.[1]
    // Today's note was written this morning: the demo's clock says 10:00.
    const date = day
      ? new Date(`${day}T${day === today ? '08:40' : '21:30'}:00`)
      : new Date(DEMO_NOW.getTime() - (((i * 37) % 95) + 1) * 86_400_000)
    fs.utimesSync(file, date, date)
  })
}

fs.rmSync(VAULT, { recursive: true, force: true })
fs.mkdirSync(VAULT, { recursive: true })
for (const [folder, notes] of Object.entries(NOTES)) for (const [name, text] of Object.entries(notes)) write(`${folder}/${name}.md`, text)
for (const [day, text] of Object.entries(DAILY)) {
  const [year, month] = day.split('-')
  write(`Daily/${year}/${month}/W${String(weekOf(day)).padStart(2, '0')}/${day}.md`, text)
}
for (const [key, text] of Object.entries(WEEKLY)) {
  const thursday = isoWeekThursday(key)
  const month = String(thursday.getUTCMonth() + 1).padStart(2, '0')
  write(`Daily/${thursday.getUTCFullYear()}/${month}/W${key.slice(-2)}/${key}.md`, text)
}
writeBoard()
writeCanvas()
writeSettings()
writeHistory()
await renderImages()
setDates()
const themed = Object.values(NOTES).reduce((n, notes) => n + Object.keys(notes).length, 0)
console.log(
  `Demo vault written to ${VAULT}: ${themed} notes, ${BOARD.lanes.flatMap((l) => l.cards).length} cards, ${Object.keys(DAILY).length + Object.keys(WEEKLY).length} periodic notes, ${Object.keys(IMAGES).length} images.`,
)
