/**
 * Periodic notes: a daily, weekly, monthly and yearly note, each made the
 * first time Recto is open in a new period.
 *
 * Where each one goes follows from which periods are on, so a folder only
 * exists when it holds more than one kind of note:
 * - a year folder always (2026/);
 * - a month folder when daily notes are on, or weekly together with monthly,
 *   or weekly with "group by month";
 * - a week folder only when daily notes are on.
 * A period with a separate folder lays itself out in that folder as if it
 * were the only one on.
 *
 * A week is an ISO week, and belongs to the year and month of its Thursday:
 * 2027-W01, which starts on 29 December 2026, goes under 2027/01. A daily
 * note stays where it always went, under its own calendar year and month.
 */

import { dailyNotePath, isoWeek, periodKey, PERIODS, thursdayOf, type Period, type PeriodicSettings } from './templates'

export type NotePlace = { folder: string; name: string; path: string; key: string }

const pad = (value: number): string => String(value).padStart(2, '0')

/** Which folders a set of periods sharing one root gets. */
export function folderLayout(on: ReadonlySet<Period>, groupByMonth: boolean): { month: boolean; week: boolean } {
  const weekly = on.has('weekly')
  return {
    month: on.has('daily') || (weekly && (on.has('monthly') || groupByMonth)),
    week: on.has('daily'),
  }
}

/** The folder a period's notes go under, and the periods that share it. */
function placement(period: Period, settings: PeriodicSettings): { root: string; on: Set<Period> } {
  const own = settings[period].folder
  if (own !== null) return { root: own, on: new Set([period]) }
  const shared = PERIODS.filter((p) => settings[p].enabled && settings[p].folder === null)
  return { root: settings.folder, on: new Set([...shared, period]) }
}

/** Where the note for this period, on this date, goes. */
export function periodNotePath(period: Period, date: Date, settings: PeriodicSettings): NotePlace {
  const { root, on } = placement(period, settings)
  if (period === 'daily') return dailyNotePath(date, root)
  const layout = folderLayout(on, settings.groupByMonth)
  const key = periodKey(period, date)
  const at = period === 'weekly' ? thursdayOf(date) : date
  const parts = [root, String(at.getFullYear())]
  if (period !== 'yearly' && layout.month) parts.push(pad(at.getMonth() + 1))
  if (period === 'weekly' && layout.week) parts.push(`W${pad(isoWeek(date).week)}`)
  const folder = parts.join('/')
  const name = `${key}.md`
  return { folder, name, path: `${folder}/${name}`, key }
}

/**
 * The period "Today's note" opens: the shortest one that is on, so with daily
 * notes off it is this week's note, then this month's, then this year's. Null
 * when none is on.
 */
export function todayPeriod(settings: PeriodicSettings): Period | null {
  return PERIODS.find((p) => settings[p].enabled) ?? null
}

const PARENTS: Record<Period, readonly Period[]> = {
  daily: ['weekly', 'monthly', 'yearly'],
  weekly: ['monthly', 'yearly'],
  monthly: ['yearly'],
  yearly: [],
}
const PROPERTY: Record<Period, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }

/**
 * The link one step up the chain, as a property: a daily note's `week:
 * [[2026-W41]]`, or its month or year when weekly notes are off. Only to
 * periods that are on, so the link always has a note to go to. A week's month
 * and year are its Thursday's.
 */
export function parentLink(period: Period, date: Date, settings: PeriodicSettings): { key: string; value: string } | null {
  const parent = PARENTS[period].find((p) => settings[p].enabled)
  if (parent === undefined) return null
  const at = period === 'weekly' ? thursdayOf(date) : date
  return { key: PROPERTY[parent], value: `[[${periodKey(parent, at)}]]` }
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).toLowerCase()

/**
 * Another note with this one's name, if there is one: names are unique in a
 * vault (links go by name), so the periodic note is then not made. Compared
 * without case, as the Mac disk does.
 */
export function nameTakenElsewhere(path: string, notes: readonly string[]): string | null {
  const name = fileName(path)
  return notes.find((other) => other !== path && fileName(other) === name) ?? null
}

export type TreeLine = { depth: number; name: string; file: boolean }

/** Paths as an indented tree, folders first: what the settings preview draws. */
export function pathTree(paths: readonly string[]): TreeLine[] {
  type Node = { folders: Map<string, Node>; files: string[] }
  const root: Node = { folders: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part)
      if (next === undefined) {
        next = { folders: new Map(), files: [] }
        node.folders.set(part, next)
      }
      node = next
    }
    node.files.push(parts[parts.length - 1]!)
  }
  const out: TreeLine[] = []
  const walk = (node: Node, depth: number): void => {
    for (const [name, child] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
      out.push({ depth, name: `${name}/`, file: false })
      walk(child, depth + 1)
    }
    for (const name of [...node.files].sort()) out.push({ depth, name, file: true })
  }
  walk(root, 0)
  return out
}
