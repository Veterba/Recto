// The shots. Each has a `setup` that gets the app ready off camera and an `act`
// that plays on camera; the rig adds the calm half second at both ends.
//
// A mini demo loops: its act puts everything back and returns the cursor to
// where it started, so its last frame is its first.

import fs from 'node:fs'
import path from 'node:path'
import { waitCalm } from './rig.mjs'

export const AI_NOTE = 'Memory consolidation'
export const AI_QUESTION = 'What are the main ideas here?'
export const AI_SUGGESTION = 'Add a summary line at the end of this note.'

const REST = [1180, 760]

/** The Data tree with the Recto folder in it, where the canvas file is. Off by default. */
const showRectoFolder = (vault) => fs.writeFileSync(path.join(vault, '.recto/recto-folder.json'), JSON.stringify({ show: true }))

const row = (s, name) => s.page.locator('[role=treeitem]').filter({ hasText: new RegExp(`^\\W*${name}(\\.\\w+)?$`) })
const section = (s, name) => s.page.getByRole('tab', { name: new RegExp(name, 'i') })
const card = (s, title) => s.page.locator('.board-card', { hasText: title })
const lane = (s, name) => s.page.locator(`.board-col[aria-label="${name}"] .board-col__cards`)
const menuItem = (s, label) => s.page.locator('.menu__item', { hasText: label })
const node = (s, text) => s.page.locator('.react-flow__node', { hasText: text })
const tool = (s, label) => s.page.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('button', { name: label, exact: true })

/** Polled by the clock: a hidden window draws no frames to poll on while nothing changes. */
const until = (s, check, arg, timeout = 30_000) => s.page.waitForFunction(check, arg, { polling: 100, timeout })

async function openNote(s, name) {
  await s.press('Meta+o')
  await s.page.keyboard.type(name)
  await until(s, (n) => document.body.textContent.includes(n), name)
  await waitCalm(s.page, 150)
  await s.press('Enter')
  await s.page.waitForSelector('.cm-content')
  await waitCalm(s.page)
}

async function openBoard(s) {
  await section(s, 'Tasks').click()
  await s.page.getByText('Renovation', { exact: true }).first().click()
  await s.page.waitForSelector('.board-card')
  await waitCalm(s.page)
}

async function openCanvas(s) {
  await section(s, 'Canvas').click()
  await s.page.getByText('Sleep research map').first().click()
  await s.page.waitForSelector('.react-flow__node')
  await waitCalm(s.page, 500)
}

/** The note gets the whole height: what an edit adds at its end stays in view. */
async function foldMentions(s) {
  await s.page.locator('.backlinks__head').click()
  await waitCalm(s.page)
}

async function showBot(s) {
  await s.page.getByRole('button', { name: 'Toggle the floating bot' }).click()
  await s.page.waitForSelector('.floating-bot.is-settled')
  await waitCalm(s.page)
}

async function ask(s, text, answers) {
  await s.page.locator('.quick-ask__input').focus()
  await s.type(text)
  await s.page.waitForSelector('.quick-ask__send:not([disabled])')
  await s.press('Enter')
  await until(s, (n) => document.querySelectorAll('.quick-ask__a .bot-md').length === n && document.querySelector('[aria-label="Stop"]') === null, answers, 60_000)
}

async function reviewAndApply(s) {
  await s.click('.quick-ask__review')
  await s.page.waitForSelector('.edits__diff')
  await waitCalm(s.page, 120)
  await sleepRead(s, 700)
  await s.click(s.page.locator('.edits__buttons .btn--primary'))
  await s.page.waitForSelector('.edits__diff', { state: 'detached' })
}

/** Time to read something on screen. */
const sleepRead = (s, ms) => s.page.waitForTimeout(ms)

export const SHOTS = {
  '01-open': {
    title: 'Open the demo vault; the graph appears and settles.',
    app: { firstRun: true },
    start: [800, 760],
    async act(s) {
      await s.click(s.page.getByRole('button', { name: 'Choose folder…' }))
      await s.page.waitForSelector('[role=treeitem]')
      await waitCalm(s.page)
      await s.click(s.page.getByRole('button', { name: 'Toggle graph' }))
      await s.page.waitForSelector('.graph__canvas')
      await s.click(s.page.getByRole('button', { name: 'Expand to full size' }))
      await s.move(...REST)
      await until(s, () => !document.querySelector('.graph__stat')?.textContent?.includes('settling'))
      await s.click(s.page.getByRole('button', { name: 'Fit to view' }))
      await waitCalm(s.page)
      await s.move(...REST)
    },
  },

  '02-write': {
    title: 'Type a short note, [[ suggestions with a match, insert, hover preview of the link.',
    app: {
      mutate: (vault) => fs.writeFileSync(path.join(vault, 'Kitchen/Pantry shelves.md'), '*A note about shelf depth in the pantry*\n\n'),
    },
    async setup(s) {
      await openNote(s, 'Pantry shelves')
    },
    start: REST,
    async act(s) {
      const line = s.page.locator('.cm-line').last()
      await s.click(line, { dx: -180 })
      await s.press('Meta+ArrowDown')
      await s.type('Shallow shelves keep everything visible. Check the depth against the ')
      await s.type('[[pan')
      await s.page.waitForSelector('.cm-tooltip-autocomplete li')
      await sleepRead(s, 900)
      await s.press('Enter')
      await s.type(' first.')
      await sleepRead(s, 400)
      await s.hover(s.page.locator('.cm-wikilink', { hasText: 'Pantry wall' }))
      await s.page.locator('.note-peek').waitFor({ timeout: 6000 })
      await waitCalm(s.page)
      await sleepRead(s, 1400)
    },
  },

  '03-board': {
    title: 'The Renovation board: drag a card to Doing, right-click → Done, click a card → panel.',
    setup: openBoard,
    start: REST,
    async act(s) {
      await s.drag(card(s, 'Confirm tile quantity'), lane(s, 'Doing'), { ghost: 'Confirm tile quantity' })
      await waitCalm(s.page)
      await s.click(card(s, 'Compare cabinet quotes'), { button: 'right' })
      await s.page.waitForSelector('.menu__item')
      await sleepRead(s, 500)
      await s.click(menuItem(s, 'Done').last())
      await waitCalm(s.page)
      await s.click(card(s, 'Measure the pantry wall'))
      await s.page.getByRole('button', { name: 'Open as note' }).waitFor()
      await waitCalm(s.page)
      await sleepRead(s, 1000)
    },
  },

  '04-canvas': {
    title: 'The canvas: pan, drag a note in from the tree, draw an arrow, "Make it a note" on a text card.',
    app: { mutate: showRectoFolder },
    async setup(s) {
      // From the Data section, where the tree and the canvas are on screen together.
      for (const folder of ['Recto', 'Canvas']) await row(s, folder).click()
      await row(s, 'Sleep research map').click()
      await s.page.waitForSelector('.react-flow__node')
      await row(s, 'Recto').click()
      await row(s, 'Sleep and memory').click()
      await row(s, 'Naps and learning').waitFor()
      await waitCalm(s.page)
    },
    start: REST,
    async act(s) {
      await s.click(tool(s, 'Hand'))
      await s.drag([980, 840], [860, 760], { ms: 900 })
      await s.click(tool(s, 'Select'))
      await s.drag(row(s, 'Naps and learning'), [1300, 200], { ghost: 'Naps and learning' })
      await s.page.locator('.react-flow__node', { hasText: 'Naps and learning' }).waitFor()
      await waitCalm(s.page)
      await s.click(tool(s, 'Arrow'))
      await s.drag(await s.centre(node(s, 'Review vocabulary')), await s.centre(node(s, 'Naps and learning')), { ms: 800 })
      await waitCalm(s.page)
      await s.click(node(s, 'Review vocabulary'), { button: 'right' })
      await s.page.waitForSelector('.menu__item')
      await sleepRead(s, 400)
      await s.click(menuItem(s, 'Make it a note'))
      await waitCalm(s.page)
      await s.move(...REST)
    },
  },

  '05-ai': {
    title: 'Quick ask on a note, the answer streams, a suggested edit → diff → Apply. A replay of the real local model.',
    async setup(s) {
      await openNote(s, AI_NOTE)
      await foldMentions(s)
      await showBot(s)
    },
    start: REST,
    async act(s) {
      await s.click('.floating-bot.is-settled')
      await s.page.waitForSelector('.quick-ask__input')
      await ask(s, AI_QUESTION, 1)
      await sleepRead(s, 500)
      await ask(s, AI_SUGGESTION, 2)
      await reviewAndApply(s)
      await waitCalm(s.page)
    },
  },

  '06-overview': {
    title: '⌃⌘H overview with the shader, scroll through stats slowly.',
    async setup(s) {
      await openNote(s, 'Learning Japanese')
    },
    start: REST,
    async act(s) {
      await sleepRead(s, 300)
      await s.press('Control+Meta+h')
      await s.page.waitForSelector('.home__window')
      await sleepRead(s, 1200)
      await s.click(s.page.getByText('Show your statistics', { exact: false }))
      await s.page.waitForSelector('.overview__scroller')
      await sleepRead(s, 500)
      await s.scrollOver('.overview__scroller', 800, 4000)
    },
  },

  'm1-tasks-are-notes': {
    title: 'Drag a card, open it as a note. Loops.',
    setup: openBoard,
    start: REST,
    async act(s) {
      await s.drag(card(s, 'Book the electrician'), lane(s, 'Doing'), { ghost: 'Book the electrician' })
      await waitCalm(s.page)
      await s.click(card(s, 'Book the electrician'))
      await s.click(s.page.getByRole('button', { name: 'Open as note' }))
      await s.page.waitForSelector('.cm-content')
      await waitCalm(s.page)
      await sleepRead(s, 1500)
      await s.press('Meta+w')
      await s.page.waitForSelector('.board-card')
      await waitCalm(s.page)
      await s.drag(card(s, 'Book the electrician'), lane(s, 'To do'), { ghost: 'Book the electrician' })
      await waitCalm(s.page)
      await s.move(...REST)
    },
  },

  'm2-ai-asks-first': {
    title: 'Suggestion → diff → Apply. Loops. A replay of the real local model.',
    app: { tapeFrom: 'suggestion' },
    async setup(s) {
      await openNote(s, AI_NOTE)
      await foldMentions(s)
      await showBot(s)
    },
    start: REST,
    async act(s, { vault }) {
      const file = path.join(vault, `Sleep and memory/${AI_NOTE}.md`)
      const original = fs.readFileSync(file, 'utf8')
      await s.click('.floating-bot.is-settled')
      await s.page.waitForSelector('.quick-ask__input')
      await ask(s, AI_SUGGESTION, 1)
      await reviewAndApply(s)
      await waitCalm(s.page)
      await sleepRead(s, 1400)
      await s.click(s.page.locator('.quick-ask').getByRole('button', { name: /Close Quick ask/ }))
      await s.page.waitForSelector('.quick-ask', { state: 'detached' })
      // Back to the start for the loop: the file as it was, as if undone.
      fs.writeFileSync(file, original)
      await until(s, () => !document.querySelector('.cm-content')?.textContent?.includes('Sleep selectively strengthens'))
      await s.move(...REST)
    },
  },

  'm3-canvas': {
    title: 'Arrange notes, arrows, group. Loops.',
    setup: openCanvas,
    start: REST,
    async act(s) {
      const idea = node(s, 'Review vocabulary')
      const [ix, iy] = await s.centre(idea)
      await s.drag([ix, iy], [ix + 330, iy - 10], { ms: 800 })
      await waitCalm(s.page)
      await s.click(tool(s, 'Arrow'))
      await s.drag(await s.centre(idea), await s.centre(node(s, 'oscillations: a three-layer')), { ms: 800 })
      await waitCalm(s.page)
      await s.click(tool(s, 'Select'))
      await s.click(node(s, 'Main question'))
      await s.page.keyboard.down('Shift')
      await s.click(s.page.locator('.react-flow__node').filter({ has: s.page.locator('img[src*="forgetting"]') }))
      await s.page.keyboard.up('Shift')
      await s.click(node(s, 'Main question'), { button: 'right' })
      await s.page.waitForSelector('.menu__item')
      await sleepRead(s, 300)
      await s.click(menuItem(s, 'Group').first())
      await waitCalm(s.page)
      await s.press('Escape')
      await sleepRead(s, 1000)
      // Back to the first frame: three undos and an empty click.
      await s.move(1120, 860)
      await s.click(null)
      for (let i = 0; i < 3; i++) {
        await s.press('Meta+z')
        await sleepRead(s, 450)
      }
      await s.click(null)
      await s.move(...REST)
    },
  },

  'm4-obsidian': {
    title: 'The same vault folder: the file tree in Recto with the .md and .canvas files.',
    app: { mutate: showRectoFolder },
    async setup(s) {
      // The row stays marked after a click: marked from the first frame too, so the loop closes.
      for (let i = 0; i < 2; i++) await row(s, 'Kitchen').click()
      await waitCalm(s.page)
    },
    start: REST,
    async act(s) {
      await s.click(row(s, 'Kitchen'))
      await row(s, 'Budget').waitFor()
      await waitCalm(s.page)
      await s.click(row(s, 'Recto'))
      await row(s, 'Canvas').waitFor()
      await s.click(row(s, 'Canvas'))
      await row(s, 'Sleep research map').waitFor()
      await waitCalm(s.page)
      await s.click(row(s, 'Budget'))
      await s.page.waitForSelector('.cm-content')
      await waitCalm(s.page)
      await sleepRead(s, 1200)
      await s.click(row(s, 'Sleep research map'))
      await s.page.waitForSelector('.react-flow__node')
      await waitCalm(s.page, 500)
      await sleepRead(s, 1500)
      await s.press('Meta+w')
      await s.press('Meta+w')
      await waitCalm(s.page)
      await s.click(row(s, 'Recto'))
      await s.click(row(s, 'Kitchen'))
      await waitCalm(s.page)
      await s.move(...REST)
    },
  },
}
