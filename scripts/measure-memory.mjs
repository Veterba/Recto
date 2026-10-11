/**
 * How much memory Recto and Ollama use, at the moments that matter: just
 * after the app opens, with a bot chat open, while a bot answers, and after a
 * few idle minutes. On a copy of the fixture vault, never the real one; the
 * window is never shown.
 *
 *   npm run build && node scripts/measure-memory.mjs --model gemma4:e4b --idle 6 [--unload 1] [--no-cards] [--embedder <models dir>]
 *
 * Recto: every process's working set (Electron's own metrics). Ollama: the
 * resident memory of its processes, and what /api/ps says the loaded model
 * takes. Prints one table to paste into the log.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OLLAMA = 'http://127.0.0.1:11434'
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const MODEL = arg('model', 'gemma4:e4b')
const IDLE_MINUTES = Number(arg('idle', '6'))
const QUESTION = arg('question', 'What do my notes say about soil for raised beds?')
/** Settings → Bots → "Unload the model after", in minutes; unset: the app's default. */
const UNLOAD = arg('unload', null)
/** Note cards off: they use the model while the Mac is idle on the charger, which keeps it loaded. */
const NO_CARDS = process.argv.includes('--no-cards')
/** The embedding model (EmbeddingGemma, ONNX) to use, read-only: without one there are no vectors to build. */
const MODELS = arg('embedder', null)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mb = (bytes) => Math.round(bytes / 1024 / 1024)

async function loaded() {
  const body = await (await fetch(`${OLLAMA}/api/ps`)).json()
  return (body.models ?? []).map((m) => ({ name: m.name, size: m.size, vram: m.size_vram }))
}

async function unloadAll() {
  for (const m of await loaded())
    await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }) })
}

/** Resident memory of every Ollama process, in bytes. */
function ollamaRss() {
  const out = execFileSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8' })
  return out
    .split('\n')
    .filter((line) => /ollama/i.test(line) && !/measure-memory/.test(line))
    .reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[0] ?? 0) * 1024, 0)
}

async function sample(app, label) {
  const metrics = await app.evaluate(({ app: electron }) =>
    electron.getAppMetrics().map((m) => ({ type: m.type, name: m.name ?? m.serviceName ?? '', kb: m.memory.workingSetSize })),
  )
  const recto = metrics.reduce((sum, m) => sum + m.kb * 1024, 0)
  const models = await loaded()
  const utility = metrics.filter((m) => m.type === 'Utility').map((m) => `${m.name || 'utility'} ${Math.round(m.kb / 1024)}`)
  return {
    label,
    recto: mb(recto),
    processes: metrics.length,
    utility: utility.join(', '),
    ollamaRss: mb(ollamaRss()),
    // Names only: /api/ps leaves the mapped weights out of its sizes; the RSS column is the real figure.
    model: models.length === 0 ? 'not loaded' : models.map((m) => m.name).join(', '),
  }
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-memory-'))
const vault = path.join(base, 'Memory vault')
fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
fs.mkdirSync(path.join(base, 'profile'))
fs.writeFileSync(
  path.join(base, 'profile', 'app-state.json'),
  JSON.stringify({
    lastVaultPath: vault,
    botDefaultModel: MODEL,
    ...(UNLOAD === null ? {} : { botUnloadMinutes: Number(UNLOAD) }),
    ...(NO_CARDS ? { botHarness: { noteCards: false } } : {}),
  }),
)

await unloadAll()
const rows = []
const app = await _electron.launch({
  args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
  env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', ...(MODELS === null ? {} : { RECTO_MODEL_DIR: MODELS }) },
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  await sleep(20_000)
  rows.push(await sample(app, 'open 20 s, no chat'))

  await page.keyboard.press('Meta+2')
  await page.locator('.bot-row').first().click()
  await page.waitForSelector('.bot-chat .composer__input')
  await sleep(15_000)
  rows.push(await sample(app, 'bot chat open 15 s'))

  await page.locator('.bot-chat .composer__input').click()
  await page.keyboard.type(QUESTION)
  await page.keyboard.press('Enter')
  let peak = null
  const started = Date.now()
  while (Date.now() - started < 180_000) {
    const now = await sample(app, 'answering (peak)')
    if (peak === null || now.recto + now.ollamaRss > peak.recto + peak.ollamaRss) peak = now
    const done = await page.evaluate(
      () => document.querySelector('.bot-chat .is-pending') === null && document.querySelectorAll('.bot-chat .msg--bot').length > 0,
    )
    if (done) break
    await sleep(1000)
  }
  rows.push(peak)
  rows.push(await sample(app, 'answer done'))

  for (let minute = 1; minute <= IDLE_MINUTES; minute++) {
    await sleep(60_000)
    if (minute === 2 || minute === IDLE_MINUTES) rows.push(await sample(app, `idle ${minute} min after the answer`))
  }

  // Typing to the bot loads the model again, before the question is sent.
  await page.locator('.bot-chat .composer__input').click()
  await page.keyboard.type('And what about')
  await sleep(15_000)
  rows.push(await sample(app, 'typed in the composer 15 s ago'))
} finally {
  await app.close()
  await unloadAll()
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

console.log(
  `\nModel ${MODEL}, ${os.totalmem() / 1024 ** 3} GB Mac, unload after ${UNLOAD ?? 'default'} min, note cards ${NO_CARDS ? 'off' : 'on'}\n`,
)
console.log('| Moment | Recto (all processes) | Utility processes (MB) | Ollama RSS | Model in memory |')
console.log('|---|---|---|---|---|')
for (const r of rows) console.log(`| ${r.label} | ${r.recto} MB (${r.processes}) | ${r.utility || '—'} | ${r.ollamaRss} MB | ${r.model} |`)
