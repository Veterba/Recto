/** AI chat: the models offered and the shape of a streamed reply. */

/**
 * The models offered in Settings.
 *
 * A short list rather than whatever the API returns: the app has to be able to
 * say what each one is *for*, and a dropdown of forty ids does not help anyone
 * choose. Ordered most capable first.
 */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', blurb: 'Most capable. Slower, and costs the most.' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', blurb: 'The balance. A good default.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', blurb: 'Fastest and cheapest.' },
] as const

export type AiModelId = (typeof AI_MODELS)[number]['id']

/** Ids saved before the 5.5 family, and what they mean now: a bot or chat that named one keeps working. */
const LEGACY_MODELS: Record<string, AiModelId> = {
  'claude-opus-5': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-5-5',
}

/** The current id for a saved one. */
export const currentAiModel = (id: string): string => LEGACY_MODELS[id] ?? id

/** What the app asks the API for on its own - a note's summary, the key test: small jobs, the cheapest model. */
export const UTILITY_MODEL: AiModelId = 'claude-haiku-5-5'

/** The longest answer asked of an API model (Anthropic's `max_tokens`): one number for every call. */
export const MAX_ANSWER_TOKENS = 4096

export const isAiModel = (value: unknown): value is AiModelId =>
  typeof value === 'string' && AI_MODELS.some((model) => model.id === currentAiModel(value))

/** One turn. The content is plain markdown - the same text the note holds. */
export type AiMessage = { role: 'user' | 'assistant'; content: string }

/** What a running stream reports back. `id` matches the `ai:send` request. */
export type AiDelta = { id: string; text: string }
export type AiDone = { id: string; stopReason: string | null; inputTokens: number; outputTokens: number }
export type AiError = { id: string; message: string }
