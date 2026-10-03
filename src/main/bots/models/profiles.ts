/**
 * Model profiles: what Recto sends with a request, per model family. The chat
 * and the eval runner both read these, so an eval measures exactly what the
 * app does.
 *
 * Small local models differ in the details - how thinking is switched off,
 * which options they honour, how they format tool calls - and the details are
 * what make an answer arrive in two seconds or twenty. A model this file has
 * no family for gets the fallback profile and is marked untested.
 */

export type ModelProfile = {
  family: string
  /** Tested with Recto; anything else gets the fallback, marked "untested". */
  tested: boolean
  /**
   * How thinking is turned off. `param`: Ollama's `think: false`, sent only
   * when the model reports the "thinking" capability (others may refuse it).
   * `none`: the model does not think out loud.
   */
  thinking: 'param' | 'none'
  options: {
    /** Tokens the model holds at once: prompt and answer together. */
    num_ctx: number
    /** The longest answer, in tokens. */
    num_predict: number
    temperature: number
    stop?: string[]
  }
  /** How the model calls tools, for later: Ollama's native format, or none it can be relied on for. */
  tools: 'ollama' | 'none'
}

const PROFILES: readonly (ModelProfile & { match: RegExp })[] = [
  {
    family: 'qwen3.5',
    match: /^qwen3\.5(:|$)/,
    tested: true,
    thinking: 'param',
    options: { num_ctx: 8192, num_predict: 600, temperature: 0.7 },
    tools: 'ollama',
  },
  {
    family: 'gemma4',
    match: /^gemma4(:|$)/,
    tested: true,
    thinking: 'param',
    options: { num_ctx: 8192, num_predict: 600, temperature: 0.7 },
    tools: 'ollama',
  },
]

const FALLBACK: ModelProfile = {
  family: 'fallback',
  tested: false,
  thinking: 'param',
  options: { num_ctx: 8192, num_predict: 600, temperature: 0.7 },
  tools: 'none',
}

export function profileFor(model: string): ModelProfile {
  const found = PROFILES.find((p) => p.match.test(model))
  if (found === undefined) return FALLBACK
  const { match: _match, ...profile } = found
  return profile
}

/** The request fields a profile sets, given what the model says it can do. */
export function requestFields(model: string, capabilities: readonly string[] | null): { think?: false; options: ModelProfile['options'] } {
  const profile = profileFor(model)
  const canThink = capabilities === null || capabilities.includes('thinking')
  return {
    ...(profile.thinking === 'param' && canThink ? { think: false as const } : {}),
    options: { ...profile.options },
  }
}
