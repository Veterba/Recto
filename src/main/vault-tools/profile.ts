import fs from 'node:fs'
import path from 'node:path'
import { RULES } from '../../shared/formatting'
import { periodNotePath } from '../../shared/periodic'
import { readSettings as readTopicSettings, readTopics } from '../topics/storage'
import { TOPIC_PREFIX } from '../../shared/topics'
import { PERIODS, type Period } from '../../shared/templates'
import { parseKanban } from '../../shared/kanban'
import { ask, boards, visibleMeta } from './read'
import { folderOf, titleOf, type Scope } from './scope'

/**
 * The vault profile: how this vault is kept, from its settings and the index,
 * built fresh on every call. Nothing in it assumes one person's workflow -
 * every convention is read from the vault itself. Excluded notes are not
 * counted; excluded folders are named, so the AI knows to leave them alone.
 */

const KEY_PATTERN: Record<Period, RegExp> = {
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/,
  yearly: /^\d{4}$/,
}

const top = <T>(map: Map<T, number>, n: number): [T, number][] => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

const LINK_STYLE =
  'Recto follows Obsidian’s rules for names and links. Notes in different folders may share a name; a folder holds one of each. Links are written [[Note name]] when only one note has the name, else with its path ([[Folder/Note name]]) - as this vault’s Obsidian settings write them - and never as Markdown paths unless the formatting profile says so. A link is read from the note it is in: a bare name means the note there or below first, then the one with the shorter path.'

const TOPICS_HOW =
  'Topics are written by Recto, not by people: it reads notes that have been quiet for a while, groups them by meaning with a local model, and lists each note’s topics as [[topics/Name]] links in its "topics" property. Leave that property alone; link notes in the text instead.'

export async function vaultProfile(scope: Scope): Promise<Record<string, unknown>> {
  const meta = await visibleMeta(scope)
  const tagsOf = new Map<string, string[]>()
  for (const t of meta.tags) tagsOf.set(t.path, [...(tagsOf.get(t.path) ?? []), t.tag])
  const keysOf = new Map<string, string[]>()
  for (const p of meta.properties) keysOf.set(p.path, [...(keysOf.get(p.path) ?? []), p.key])

  // Top-level folders and what is in them.
  const folders = new Map<string, string[]>()
  for (const n of meta.notes) {
    const head = n.path.includes('/') ? n.path.slice(0, n.path.indexOf('/')) : ''
    folders.set(head, [...(folders.get(head) ?? []), n.path])
  }
  const periodicRoots = PERIODS.filter((p) => scope.templates.periodic[p].enabled).map((p) =>
    (scope.templates.periodic[p].folder ?? scope.templates.periodic.folder).split('/')[0]!.toLowerCase(),
  )
  const folderList = [...folders.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([folder, paths]) => {
      const keys = new Map<string, number>()
      const tags = new Map<string, number>()
      for (const p of paths) {
        for (const k of keysOf.get(p) ?? []) keys.set(k, (keys.get(k) ?? 0) + 1)
        for (const t of tagsOf.get(p) ?? []) tags.set(t, (tags.get(t) ?? 0) + 1)
      }
      return {
        folder: folder === '' ? '(top of the vault)' : `${folder}/`,
        notes: paths.length,
        subfolders: new Set(paths.map((p) => folderOf(p)).filter((f) => f !== folder && f !== '')).size,
        ...(keys.size === 0 ? {} : { common_properties: top(keys, 5).map(([k]) => k) }),
        ...(tags.size === 0 ? {} : { common_tags: top(tags, 5).map(([t]) => t) }),
        ...(periodicRoots.includes(folder.toLowerCase()) ? { holds: 'periodic notes' } : {}),
      }
    })

  // Templates.
  const templateFolder = scope.templates.folder
  const templates = scope.notes.filter((p) => p.toLowerCase().startsWith(`${templateFolder.toLowerCase()}/`))

  // Periodic notes: what is on, where they go, when the last one was made.
  const today = new Date()
  const periodic = Object.fromEntries(
    PERIODS.map((period) => {
      const s = scope.templates.periodic[period]
      if (!s.enabled) return [period, { on: false }]
      const root = (s.folder ?? scope.templates.periodic.folder).toLowerCase()
      const last = meta.notes
        .filter((n) => n.path.toLowerCase().startsWith(`${root}/`) && KEY_PATTERN[period].test(titleOf(n.path)))
        .map((n) => titleOf(n.path))
        .sort()
        .at(-1)
      return [
        period,
        { on: true, today: periodNotePath(period, today, scope.templates.periodic).path, template: s.template, last_note: last ?? null },
      ]
    }),
  )

  // Properties and tags in use.
  const keyCount = new Map<string, number>()
  const examples = new Map<string, Set<string>>()
  for (const p of meta.properties) {
    keyCount.set(p.key, (keyCount.get(p.key) ?? 0) + 1)
    const ex = examples.get(p.key) ?? new Set()
    if (p.value !== null && p.value.length <= 40 && ex.size < 3) ex.add(p.value)
    examples.set(p.key, ex)
  }
  const tagCount = new Map<string, number>()
  for (const t of meta.tags) tagCount.set(t.tag, (tagCount.get(t.tag) ?? 0) + 1)

  // Topics, only when they are on.
  const topicSettings = readTopicSettings()
  let topics: unknown = undefined
  if (topicSettings.enabled) {
    const state = readTopics()
    const list = []
    for (const t of state.topics.filter((t) => !state.deleted.includes(t.id))) {
      const { paths } = await ask({ kind: 'link-sources', target: `${TOPIC_PREFIX}${t.name}` }, 'link-sources-result')
      list.push({ name: t.name, notes: paths.filter((p) => !scope.hidden(p)).length })
    }
    topics = { on: true, how: TOPICS_HOW, topics: list.sort((a, b) => b.notes - a.notes).slice(0, 40) }
  }

  const f = scope.settings.formatting
  return {
    notes: meta.notes.length,
    folders: folderList,
    templates:
      templates.length === 0
        ? { folder: templateFolder, templates: 'none' }
        : { folder: templateFolder, templates: templates.map(titleOf) },
    periodic_notes: periodic,
    links: {
      style: LINK_STYLE,
      form: f.linkForm === 'leave' ? 'as each note has it' : f.linkForm === 'wiki' ? '[[Note name]]' : '[text](path.md)',
    },
    properties: top(keyCount, 30).map(([key, count]) => ({ key, notes: count, examples: [...(examples.get(key) ?? [])] })),
    tags: top(tagCount, 50).map(([tag, count]) => ({ tag, notes: count })),
    boards: (await boards(scope)).map((b) => ({
      name: titleOf(b.path),
      lanes: parseKanban(b.text).lanes.map((l) => ({ title: l.title, cards: l.items.length })),
    })),
    ...(topics === undefined ? {} : { topics }),
    excluded_from_ai: scope.settings.excluded,
    formatting: RULES.filter((r) => f[r.key] !== 'leave').map((r) => ({
      rule: r.label,
      value: r.options.find((o) => o.value === f[r.key])!.label,
    })),
    formatting_note: 'Recto applies these rules to the lines you write; anything not listed is left as you write it.',
    write_mode:
      scope.settings.writeMode === 'read'
        ? 'read only: write tools will refuse'
        : scope.settings.writeMode === 'propose'
          ? 'proposals: the person applies or discards each one'
          : 'direct: writes are applied at once, after a backup',
  }
}

/** A starting AI guide, filled from the profile - no model; the person edits it before it is saved. */
export async function draftGuide(scope: Scope): Promise<string> {
  const profile = (await vaultProfile(scope)) as {
    folders: { folder: string; notes: number }[]
    periodic_notes: Record<string, { on: boolean; today?: string }>
    templates: { folder: string; templates: string[] | 'none' }
    boards: { name: string }[]
    tags: { tag: string }[]
  }
  const on = Object.entries(profile.periodic_notes).filter(([, v]) => v.on)
  const lines = [
    '# AI guide',
    '',
    'How I want AI tools to work in this vault. Recto gives this note to every AI client before it writes anything. Edit it freely: it is a normal note.',
    '',
    '## About this vault',
    '',
    '- What it is for: (write it here)',
    ...profile.folders.slice(0, 8).map((f) => `- ${f.folder} (${f.notes} notes): (what goes here)`),
    '',
    '## How I write',
    '',
    '- Language: (e.g. English, or the language of the note being edited)',
    '- Tone: (e.g. short, plain, no filler)',
    ...(profile.templates.templates === 'none'
      ? []
      : [`- Templates in ${profile.templates.folder}/: ${profile.templates.templates.join(', ')}`]),
    ...(on.length === 0 ? [] : [`- Periodic notes: ${on.map(([p]) => p).join(', ')}. (What belongs in them.)`]),
    ...(profile.boards.length === 0 ? [] : [`- Boards: ${profile.boards.map((b) => b.name).join(', ')}. (When to add a card.)`]),
    ...(profile.tags.length === 0
      ? []
      : [
          `- Tags I use: ${profile.tags
            .slice(0, 10)
            .map((t) => `#${t.tag}`)
            .join(' ')}`,
        ]),
    '',
    '## Always',
    '',
    '- Ask before making a new note when an existing one fits.',
    '- Link related notes with [[Note name]].',
    '',
    '## Never',
    '',
    '- (things AI must not do here)',
    '',
  ]
  return lines.join('\n')
}

export const guideExists = (scope: Scope, p: string): boolean => fs.existsSync(path.join(scope.vault, p))
