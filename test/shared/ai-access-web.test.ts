import { describe, expect, it } from 'vitest'
import { coerceAiAccess, DEFAULT_AI_ACCESS } from '../../src/shared/ai-access'

describe('web access per provider, as the vault keeps it', () => {
  it('none until turned on: an older settings file has no web at all', () => {
    expect(DEFAULT_AI_ACCESS.web).toEqual([])
    expect(coerceAiAccess({ cloud: true }).web).toEqual([])
  })

  it('keeps only providers that can reach the web, once each', () => {
    expect(coerceAiAccess({ web: ['codex', 'ollama', 'anthropic', 'codex', 7, 'nope'] }).web).toEqual(['codex', 'anthropic'])
    expect(coerceAiAccess({ web: 'codex' }).web).toEqual([])
  })
})
