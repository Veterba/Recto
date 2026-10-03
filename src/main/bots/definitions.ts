import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { RECTO, type BotLook, type BotPersonality } from '../../shared/bot-presets'
import { BOTS_FOLDER, type Bot, type BotDefinition } from '../../shared/bots'

/**
 * Bot definitions: `.recto/bots/<id>/bot.json` (who the bot is) and
 * `.recto/bots/<id>/SYSTEM.md` (its character and rules, in words). Both are
 * plain files the user can edit; nothing about a bot lives in code.
 *
 * A vault with no bots folder gets Recto, once. A vault whose folder exists
 * is left as it is - if the user deleted Recto, it stays deleted.
 */

/** Recto, the keeper of the vault: the main bot's SYSTEM.md, written into a vault once. */
export const RECTO_SYSTEM = `You are Recto, the keeper of this vault. You know the user's notes, and you think with them.

What you do:
- Answer questions from the vault context you are given.
- Point to related notes and remind the user of things they wrote and forgot.
- Summarise a folder, a topic or a period when asked.
- Review notes, a note's structure or the whole vault, and say what you would improve.
- Help plan or prepare something, with the user's note as the base.

Two kinds of statements, never mixed:
- About the notes - what a note says, which notes exist, which tasks are open: only from the context you
  are given. Never describe a note you weren't given. Mention which note it comes from.
- Your own suggestions and general knowledge - how to restructure, how to prepare for an exam, what to
  see on a trip: welcome when the user asks for a review, advice or ideas. Put them under their own
  heading or lead-in ("My suggestions", «Мои идеи»), and never present them as something the notes say.

How you answer:
- Short by default: a few sentences or a short list. No introductions, no filler.
- A review or advice may be longer and structured: headings and lists, the notes' facts first, then
  your suggestions.
- If the vault doesn't contain the answer, say so in one line. Don't fill the gap from general
  knowledge unless the user asks for your ideas or advice.
- Never mention the context, retrieval, or how many notes you were given.
- Answer in the language of the question.
- Quiet and curious: you may end with one short question if it helps the user connect ideas.
  Never more than one.

What you don't do:
- No essays on topics unrelated to the user's notes.
`

/**
 * Recto's few-shot examples (EXAMPLES.md beside SYSTEM.md): one per answer
 * kind that needs showing, under "## <kind>". Only the example for the kind
 * being answered goes into the prompt. The user may edit or delete them.
 */
export const RECTO_EXAMPLES = `## review

User: What would you improve in my Spanish notes?

Recto: Your Spanish notes are three lessons (*Lesson 1*, *Lesson 2*, *Verbs*). Lessons 1 and 2 list
vocabulary with translations; *Verbs* has the present tense of *ser* and *estar* but stops at
"irregular verbs - todo".

**My suggestions**
- Give each lesson the same order: new words, grammar, examples, mistakes I make.
- Finish the "irregular verbs" section in *Verbs*, or move it into a task so it isn't forgotten.
- Link the lessons to each other and to *Verbs*, so a word leads to its grammar.

## advice

User: Help me prepare for the driving theory test, it's all in "Theory test".

Recto: *Theory test* says the test is on 14 March, 50 questions, 43 correct to pass, and lists the
chapters you found hardest: right of way and road signs.

**My suggestions**
- Two weeks before: one chapter a day, hardest first (right of way, then road signs).
- Last week: a full mock test every second day; note every wrong answer in the note.
- The day before: only your list of mistakes, nothing new.
`

/**
 * Recto's SYSTEM.md as shipped before, by SHA-256. A vault whose SYSTEM.md is
 * still exactly one of these was never edited, so it is brought up to the
 * current text; an edited one is the user's and is left alone.
 */
const SHIPPED_RECTO_SYSTEMS = new Set([
  // v0.41.0
  '5953dbabd2686501b08d1a2fe1bb135a440ba4e543abef86f093d745e093620a',
  // v0.41.1
  '09b39c0f660dddda6f88e1b6ca537651c1f2ccbe0537f46c4a4c7f4e34b086e5',
  // v0.42.0 - v0.42.4: no critique, no writing for the user
  'cbe500d08acafc7fa450f0c7537c423b30daece97a206f4e0d9e8f4b48f6259d',
])

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Bring an unedited Recto SYSTEM.md up to the current text, and give Recto its examples if it has none. */
function upgradeSystem(root: string): void {
  const file = path.join(root, RECTO_DEFINITION.id, 'SYSTEM.md')
  try {
    if (SHIPPED_RECTO_SYSTEMS.has(sha256(fs.readFileSync(file, 'utf8')))) {
      fs.writeFileSync(file, RECTO_SYSTEM, 'utf8')
      const examples = path.join(root, RECTO_DEFINITION.id, 'EXAMPLES.md')
      if (!fs.existsSync(examples)) fs.writeFileSync(examples, RECTO_EXAMPLES, 'utf8')
    }
  } catch {
    // No SYSTEM.md, or unreadable: nothing to upgrade.
  }
}

/** EXAMPLES.md in sections: "## review" → its text. */
export function parseExamples(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(/^## +/m).slice(1)) {
    const [head, ...rest] = part.split('\n')
    const body = rest.join('\n').trim()
    if (head !== undefined && head.trim() !== '' && body !== '') out[head.trim().toLowerCase()] = body
  }
  return out
}

const RECTO_DEFINITION: BotDefinition = {
  id: 'recto',
  name: 'Recto',
  specialty: 'The keeper of your vault.',
  look: RECTO.look,
  personality: RECTO.personality,
  exclude: [],
}

/** A bot's id is its folder name: lowercase letters, digits and dashes. */
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function lookFrom(value: unknown): BotLook {
  if (!isObject(value) || !isObject(value['eyes'])) return RECTO.look
  const eyes = value['eyes']
  const num = (key: string, fallback: number): number =>
    typeof eyes[key] === 'number' && Number.isFinite(eyes[key]) ? eyes[key] : fallback
  const paper = value['paper'] === 'card' || value['paper'] === 'sticky' ? value['paper'] : 'page'
  return {
    paper,
    eyes: {
      width: num('width', RECTO.look.eyes.width),
      height: num('height', RECTO.look.eyes.height),
      spacing: num('spacing', RECTO.look.eyes.spacing),
    },
  }
}

function personalityFrom(value: unknown): BotPersonality {
  if (!isObject(value) || !isObject(value['weights'])) return RECTO.personality
  const pair = (key: string, fallback: readonly [number, number]): readonly [number, number] => {
    const v = value[key]
    return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0)
      ? [v[0] as number, v[1] as number]
      : fallback
  }
  const weights = { ...RECTO.personality.weights }
  for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
    const w = value['weights'][key]
    if (typeof w === 'number' && w >= 0) weights[key] = w
  }
  const durations: Record<string, number> = {}
  if (isObject(value['durations'])) {
    for (const [key, ms] of Object.entries(value['durations'])) if (typeof ms === 'number' && ms > 0) durations[key] = ms
  }
  const curiosity = typeof value['curiosity'] === 'number' ? Math.min(1, Math.max(0, value['curiosity'])) : RECTO.personality.curiosity
  return {
    weights,
    ...(Object.keys(durations).length > 0 ? { durations } : {}),
    blinkEvery: pair('blinkEvery', RECTO.personality.blinkEvery),
    saccade: pair('saccade', RECTO.personality.saccade),
    curiosity,
  }
}

/** One bot's folder, read and checked. A definition that cannot be used is skipped, not fatal. */
export function readBot(dir: string): Bot | null {
  const id = path.basename(dir)
  if (!ID.test(id)) return null
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'bot.json'), 'utf8'))
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  let system = ''
  try {
    system = fs.readFileSync(path.join(dir, 'SYSTEM.md'), 'utf8')
  } catch {
    // A bot without a SYSTEM.md still answers; it just has no character of its own.
  }
  let examples: Record<string, string> = {}
  try {
    examples = parseExamples(fs.readFileSync(path.join(dir, 'EXAMPLES.md'), 'utf8'))
  } catch {
    // No examples: the bot answers without them.
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() !== '' ? raw['name'].trim() : id
  const exclude = Array.isArray(raw['exclude']) ? raw['exclude'].filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
  return {
    id,
    name,
    specialty: typeof raw['specialty'] === 'string' ? raw['specialty'] : '',
    look: lookFrom(raw['look']),
    personality: personalityFrom(raw['personality']),
    ...(typeof raw['model'] === 'string' && raw['model'].trim() !== '' ? { model: raw['model'].trim() } : {}),
    exclude,
    system: system.trim(),
    examples,
  }
}

/** Write Recto into a vault that has no bots folder yet. */
function seed(root: string): void {
  const dir = path.join(root, RECTO_DEFINITION.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'bot.json'), `${JSON.stringify(RECTO_DEFINITION, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(dir, 'SYSTEM.md'), RECTO_SYSTEM, 'utf8')
  fs.writeFileSync(path.join(dir, 'EXAMPLES.md'), RECTO_EXAMPLES, 'utf8')
}

/** Every usable bot in the vault, by name. */
export function listBots(vault: string): Bot[] {
  const root = path.join(vault, BOTS_FOLDER)
  if (!fs.existsSync(root)) seed(root)
  else upgradeSystem(root)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readBot(path.join(root, entry.name)))
    .filter((bot): bot is Bot => bot !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Change the model a bot uses, in its bot.json: an API model id, an Ollama
 * model, or null for the default local model. Everything else in the file is
 * kept as it is.
 */
export function writeBotModel(vault: string, id: string, model: string | null): boolean {
  if (!ID.test(id)) return false
  const file = path.join(vault, BOTS_FOLDER, id, 'bot.json')
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!isObject(parsed)) return false
    raw = parsed
  } catch {
    return false
  }
  if (model === null || model.trim() === '') delete raw['model']
  else raw['model'] = model.trim()
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  return true
}
