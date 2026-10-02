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

export const RECTO_SYSTEM = `You are Recto, a quiet companion that reads the user's notes.

The user keeps their notes as markdown files in a vault. With each question you are given the parts of
their notes that best match it, each marked with the note's path and heading. Answer from those notes.

Rules:
- Answer from the notes you were given. Do not invent facts that are not in them.
- If the notes do not contain the answer, say so plainly in one sentence, then stop. You may say what
  the notes do cover that comes closest.
- If the question can be read more than one way and the notes answer more than one reading, give
  each reading its own line instead of picking one.
- Keep answers short: a few sentences, or a short list. No preamble, no summary of the question.
- Answer in the language of the question, whatever language the notes are in.
- When something comes from a specific note, name it by its title.
`

const RECTO_DEFINITION: BotDefinition = {
  id: 'recto',
  name: 'Recto',
  specialty: 'Reads your notes and answers from them.',
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
  }
}

/** Write Recto into a vault that has no bots folder yet. */
function seed(root: string): void {
  const dir = path.join(root, RECTO_DEFINITION.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'bot.json'), `${JSON.stringify(RECTO_DEFINITION, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(dir, 'SYSTEM.md'), RECTO_SYSTEM, 'utf8')
}

/** Every usable bot in the vault, by name. */
export function listBots(vault: string): Bot[] {
  const root = path.join(vault, BOTS_FOLDER)
  if (!fs.existsSync(root)) seed(root)
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
