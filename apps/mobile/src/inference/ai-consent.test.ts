import { describe, expect, it, vi } from 'vitest'

vi.mock('../data/repo', () => ({ consentGiven: async () => false, recordConsent: async () => undefined }))

import { aiConsentCopy } from './ai-consent'
import { DISCLOSURE_DATA_PATH } from './publik-copy'

describe('AI consent names the company that gets the data (App Store 5.1.2(i))', () => {
  it('the publik path names publik and the AI providers behind it', () => {
    const c = aiConsentCopy('publik', 'Nut AI')
    expect(c.title).toBe('Send meal photos to publik?')
    expect(c.body).toContain('publik (publikhq.com)')
    expect(c.body).toContain('publik sends them to the AI provider that answers (for example Anthropic, Google or OpenAI).')
    expect(c.decline).toBe('Not now')
    expect(DISCLOSURE_DATA_PATH).toContain('for example Anthropic, Google or OpenAI')
  })

  it('an own-key path names the chosen provider only', () => {
    for (const [id, name] of [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['google', 'Google']] as const) {
      const c = aiConsentCopy(id, 'Nut AI')
      expect(c.title).toBe(`Send meal photos to ${name}?`)
      expect(c.body).toContain(`to ${name}, with your own key.`)
      expect(c.body).not.toContain('publik')
    }
  })
})
