// Asks the real local model the demo's questions, once, on the demo vault, and
// saves every exchange. The AI shots replay that tape, word for word.
//
//   npm run demo:record-ai

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { AI_TAPE } from './paths.mjs'
import { openApp, sleep, waitCalm } from './rig.mjs'
import { AI_NOTE, AI_QUESTION, AI_SUGGESTION } from './shots.mjs'

const ollamaUp = () =>
  fetch('http://127.0.0.1:11434/api/tags').then(
    (r) => r.ok,
    () => false,
  )

let server = null
if (!(await ollamaUp())) {
  server = spawn('ollama', ['serve'], { stdio: 'ignore' })
  while (!(await ollamaUp())) await sleep(200)
}

const { page, close } = await openApp({ ai: 'record' })
let suggestionStart = 0
try {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(AI_NOTE)
  await page.waitForSelector('.palette [role=option], .palette__item')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.cm-content')
  await page.getByRole('button', { name: 'Toggle the floating bot' }).click()
  await page.locator('.floating-bot.is-settled').click()
  await page.waitForSelector('.quick-ask__input')
  const ask = async (question, answers) => {
    await page.locator('.quick-ask__input').fill(question)
    await page.waitForSelector('.quick-ask__send:not([disabled])', { timeout: 120_000 })
    await sleep(300)
    await page.locator('.quick-ask__input').focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      (n) => document.querySelectorAll('.quick-ask__a .bot-md').length === n && document.querySelector('[aria-label="Stop"]') === null,
      answers,
      { timeout: 300_000 },
    )
    await waitCalm(page)
    await sleep(500)
  }
  await ask(AI_QUESTION, 1)
  suggestionStart = JSON.parse(fs.readFileSync(AI_TAPE, 'utf8')).chats.length
  await ask(AI_SUGGESTION, 2)
  await page.waitForSelector('.quick-ask__review', { timeout: 10_000 })
  console.log(await page.locator('.quick-ask__a').allTextContents())
} finally {
  await close()
  server?.kill()
}
// After the app has gone: it writes the tape too.
const tape = JSON.parse(fs.readFileSync(AI_TAPE, 'utf8'))
tape.suggestionStart = suggestionStart
fs.writeFileSync(AI_TAPE, JSON.stringify(tape, null, 1))
console.log(`Saved ${tape.chats.length} exchanges to ${AI_TAPE}.`)
