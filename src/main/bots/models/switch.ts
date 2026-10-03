import { isAiModel } from '../../../shared/ai'

/**
 * What changing a bot's model does to memory. Only one local model fits at a
 * time on a 16 GB Mac, so the one it used comes out first and the new one goes
 * in straight away. An API model takes no local memory either way.
 */
export function switchPlan(before: string, after: string): { unload: string | null; preload: string | null } {
  if (before === after) return { unload: null, preload: null }
  return {
    unload: isAiModel(before) ? null : before,
    preload: isAiModel(after) ? null : after,
  }
}
