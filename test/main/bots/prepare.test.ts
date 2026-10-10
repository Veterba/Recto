import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, on: vi.fn() },
  shell: {},
  powerMonitor: { isOnBatteryPower: () => false, getSystemIdleTime: () => 999 },
  utilityProcess: {},
}))
vi.mock('../../../src/main/index-client', () => ({ send: vi.fn() }))
vi.mock('../../../src/main/vault', () => ({ currentVault: () => null }))

import { asksDate, dateText, periodLabel, runtimeFacts } from '../../../src/main/bots/prepare'

describe('runtime facts', () => {
  const today = new Date(2026, 9, 10)

  it('today with its weekday, the model and where it runs, the note count', () => {
    const facts = runtimeFacts(today, 'qwen3.5:9b', 812)
    expect(facts).toContain('Today: Saturday, 10 October 2026 (2026-10-10).')
    expect(facts).toContain('qwen3.5:9b, running locally via Ollama')
    expect(facts).toContain('The vault has 812 notes.')
    expect(runtimeFacts(today, 'qwen3.5:9b', null)).not.toContain('notes.')
    expect(runtimeFacts(today, 'qwen3.5:9b', 812, 'ru')).toContain('«ты»')
    expect(runtimeFacts(today, 'qwen3.5:9b', 812, 'en')).toContain('answer in English')
  })

  it('names the period being read', () => {
    expect(periodLabel({ from: '2026-09-28', to: '2026-10-04' }, today, true)).toBe('прошлую неделю')
    expect(periodLabel({ from: '2026-10-05', to: '2026-10-10' }, today, false)).toBe('this week')
    expect(periodLabel({ from: '2026-10-09', to: '2026-10-09' }, today, false)).toBe('yesterday')
    expect(periodLabel({ from: '2026-01-01', to: '2026-02-01' }, today, false)).toBe('those days')
  })
})

describe('today, said by the harness', () => {
  const today = new Date(2026, 9, 10)
  it('the date in the question’s language', () => {
    expect(dateText(today, 'en')).toBe('Saturday, 10 October 2026')
    expect(dateText(today, 'ru')).toBe('суббота, 10 октября 2026')
  })

  it('date questions, and not questions about what happened today', () => {
    expect(asksDate("What's the date today?")).toBe(true)
    expect(asksDate('Какое сегодня число?')).toBe(true)
    expect(asksDate('What did I do today?')).toBe(false)
  })
})
