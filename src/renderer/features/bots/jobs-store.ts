import { useSyncExternalStore } from 'react'
import { isActive, type BotJob } from '@shared/bots'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../app/api'
import { markUnread } from './unread'

/**
 * The answers main is working on (bots/jobs.ts), as the renderer sees them:
 * one subscription for the whole app, so a chat that closes only stops
 * reading it. The chat shows its topic's job, History each topic's, the
 * sidebar row whether its bot is answering.
 */

const byId = new Map<string, BotJob>()
const listeners = new Set<() => void>()
const openListeners = new Set<(event: { botId: string; topic: string }) => void>()
let version = 0
let started = false

function emit(): void {
  version++
  for (const listener of listeners) listener()
}

function put(job: BotJob): void {
  // A topic shows its newest job; an ended one stays until the next replaces it.
  for (const [id, other] of byId) if (other.topic === job.topic && id !== job.id && !isActive(other) && isActive(job)) byId.delete(id)
  byId.set(job.id, job)
  emit()
}

function start(): void {
  if (started) return
  started = true
  api.on(IPC_EVENT.botsJob, put)
  api.on(IPC_EVENT.botsUnread, (event) => markUnread(event.botId))
  api.on(IPC_EVENT.botsOpenTopic, (event) => {
    for (const listener of openListeners) listener(event)
  })
  void api.invoke(IPC.botsJobs).then((jobs) => {
    for (const job of jobs) byId.set(job.id, job)
    emit()
  })
}

/** Re-render on every job change. */
export function useJobs(): number {
  start()
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}

/** A topic's newest job: running, waiting, or just ended. */
export function jobForTopic(topic: string | null): BotJob | null {
  if (topic === null) return null
  let found: BotJob | null = null
  for (const job of byId.values()) if (job.topic === topic && (found === null || isActive(job) || !isActive(found))) found = job
  return found
}

/** Every job of a topic main still has: the running one, waiting ones, the last ended. */
export function topicJobs(topic: string | null): BotJob[] {
  return topic === null ? [] : [...byId.values()].filter((j) => j.topic === topic)
}

/** The bot's job that runs now, if any, else one of its waiting ones. */
export function botJob(botId: string): BotJob | null {
  const mine = [...byId.values()].filter((j) => j.botId === botId && isActive(j))
  return mine.find((j) => j.state !== 'queued') ?? mine[0] ?? null
}

/** The bot's newest ended job, to re-read what it wrote: main writes topic files as its own writes, unannounced. */
export function lastEnded(botId: string): string | null {
  const ended = [...byId.values()].filter((j) => j.botId === botId && !isActive(j))
  return ended.at(-1)?.id ?? null
}

/** A notification about an answer was clicked. */
export function onOpenTopic(listener: (event: { botId: string; topic: string }) => void): () => void {
  start()
  openListeners.add(listener)
  return () => openListeners.delete(listener)
}

/** "2nd", "3rd": a place in the queue. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}
