import { IPC } from '@shared/ipc'
import { START_PLACE, type OverviewData, type OverviewPlace, type OverviewTopic } from '@shared/overview'
import { api } from '../../app/api'

/**
 * The overview's memory between openings: where it was left (userData, so a
 * restart keeps it) and the last figures it showed (this session only, so it
 * reopens on them at once and refreshes underneath).
 */

let place: OverviewPlace = START_PLACE
let loading: Promise<OverviewPlace> | null = null

/** Read once, early - at vault open - so ⌃⌘H never waits for it. */
export function loadPlace(): Promise<OverviewPlace> {
  loading ??= api
    .invoke(IPC.overviewPlace)
    // A place saved before panes were remembered has none: the welcome.
    .then((stored) => (place = { ...START_PLACE, ...stored }))
    .catch(() => place)
  return loading
}

export const currentPlace = (): OverviewPlace => place

let saveTimer = 0

/** Kept at once in memory; written a moment later, so a scroll is one write, not a hundred. */
export function savePlace(next: OverviewPlace): void {
  place = next
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void api.invoke(IPC.overviewSetPlace, place).catch(() => undefined), 250)
}

let lastData: OverviewData | null = null
let lastTopics: OverviewTopic[] | null = null

/** Another vault: the last one's figures must not flash up in it. */
export function forgetFigures(): void {
  lastData = null
  lastTopics = null
}

export const cachedData = (): OverviewData | null => lastData
export const cachedTopics = (): OverviewTopic[] | null => lastTopics

export async function fetchData(today: string, now: number): Promise<OverviewData | null> {
  const data = await api.invoke(IPC.overviewData, today, now).catch(() => null)
  if (data !== null) lastData = data
  return data
}

export async function fetchTopics(): Promise<OverviewTopic[] | null> {
  lastTopics = await api.invoke(IPC.overviewTopics).catch(() => null)
  return lastTopics
}
