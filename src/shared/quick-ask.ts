import type { BotStep } from './bots'
import type { ProviderProblem } from './providers'

/** Quick ask's answers, streamed from main to its window (main/providers/quick-ask.ts). */
export type QuickAskEvent =
  | { thread: string; type: 'text'; text: string }
  | { thread: string; type: 'steps'; steps: BotStep[] }
  | { thread: string; type: 'done' | 'cancelled'; sources: string[] }
  | { thread: string; type: 'error'; problem: ProviderProblem }
