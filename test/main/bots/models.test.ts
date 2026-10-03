import { describe, expect, it } from 'vitest'
import { hintFor, localChoices, recommendedFor } from '../../../src/main/bots/models/catalog'
import { profileFor, requestFields } from '../../../src/main/bots/models/profiles'
import { switchPlan } from '../../../src/main/bots/models/switch'

const GB16 = 16 * 2 ** 30

describe('model profiles', () => {
  it('knows the families it was tested with, and falls back for the rest', () => {
    expect(profileFor('qwen3.5:9b')).toMatchObject({ family: 'qwen3.5', tested: true })
    expect(profileFor('gemma4:12b')).toMatchObject({ family: 'gemma4', tested: true })
    expect(profileFor('gemma4:e4b').family).toBe('gemma4')
    expect(profileFor('llama3:8b')).toMatchObject({ family: 'fallback', tested: false })
  })

  it('turns thinking off only for a model that can think', () => {
    expect(requestFields('qwen3.5:9b', ['completion', 'thinking'])).toMatchObject({ think: false })
    expect(requestFields('gemma4:e4b', ['completion'])).not.toHaveProperty('think')
    expect(requestFields('qwen3.5:9b', ['completion', 'thinking']).options).toMatchObject({ num_ctx: 8192, num_predict: 600 })
  })
})

describe('the picker on this Mac', () => {
  it('says what each recommended model means on 16 GB', () => {
    expect(hintFor('qwen3.5:9b', 6_590_000_000, GB16)).toEqual({ hint: 'Recommended', fits: true })
    expect(hintFor('gemma4:12b', 8_020_000_000, GB16)).toEqual({ hint: 'Better languages, slower, tight on 16 GB', fits: true })
    expect(hintFor('gemma4:e4b', 6_580_000_000, GB16)).toEqual({ hint: 'Fastest, simpler answers', fits: true })
    expect(hintFor('qwen3:14b', 9_276_198_565, GB16)).toEqual({ hint: 'Too big for this Mac', fits: false })
    expect(recommendedFor(32 * 2 ** 30)).toBe('gemma4:12b')
  })

  it('lists installed models first, then the recommended ones to download', () => {
    const choices = localChoices(
      [
        { name: 'qwen3.5:9b', bytes: 6_590_000_000 },
        { name: 'llama3:8b', bytes: 4_700_000_000 },
      ],
      GB16,
    )
    expect(choices.map((c) => [c.name, c.installed, c.untested])).toEqual([
      ['qwen3.5:9b', true, false],
      ['llama3:8b', true, true],
      ['gemma4:12b', false, false],
      ['gemma4:e4b', false, false],
    ])
  })
})

describe('switching models', () => {
  it('unloads the old local model and preloads the new one', () => {
    expect(switchPlan('qwen3.5:9b', 'gemma4:12b')).toEqual({ unload: 'qwen3.5:9b', preload: 'gemma4:12b' })
  })
  it('an API model takes no local memory, either way', () => {
    expect(switchPlan('qwen3.5:9b', 'claude-sonnet-5')).toEqual({ unload: 'qwen3.5:9b', preload: null })
    expect(switchPlan('claude-sonnet-5', 'qwen3.5:9b')).toEqual({ unload: null, preload: 'qwen3.5:9b' })
  })
  it('no change, nothing moves', () => {
    expect(switchPlan('qwen3.5:9b', 'qwen3.5:9b')).toEqual({ unload: null, preload: null })
  })
})
