import { describe, expect, it, vi } from 'vitest'

vi.mock('../data/repo', () => ({ consentGiven: async () => false, recordConsent: async () => undefined }))

import { aiConsentCopy, publikProvidersSentence } from './ai-consent'
import { DISCLOSURE_DATA_PATH } from './publik-copy'

describe('AI consent names the company that gets the data (App Store 5.1.2(i))', () => {
  it("the publik path names publik and publik's own list of AI providers (GET /wallet ai_providers)", () => {
    const c = aiConsentCopy('publik', 'Nut AI', ['OpenRouter', 'Amazon Web Services', 'OpenAI', 'Google'])
    expect(c.title).toBe('Send meal photos to publik?')
    expect(c.body).toContain('publik (publikhq.com). publik sends them to the AI provider that answers: OpenRouter, Amazon Web Services, OpenAI or Google.')
    expect(c.decline).toBe('Not now')
    expect(publikProvidersSentence(['OpenAI'])).toBe('publik sends them to the AI provider that answers: OpenAI.')
    expect(publikProvidersSentence(['OpenAI', 'Google'])).toBe('publik sends them to the AI provider that answers: OpenAI or Google.')
  })

  it('without the list, the publik path says the same with no company names (never a hard-coded list)', () => {
    for (const none of [null, undefined, []]) {
      const c = aiConsentCopy('publik', 'Nut AI', none)
      expect(c.body).toContain('publik (publikhq.com). publik sends them to the AI provider that answers. Your food log')
      expect(c.body).not.toMatch(/for example|Anthropic|OpenAI|Google|OpenRouter|Amazon/)
    }
    expect(DISCLOSURE_DATA_PATH).toContain('to the AI provider that answers.')
    expect(DISCLOSURE_DATA_PATH).not.toMatch(/for example|Anthropic|OpenAI|Google/)
  })

  it('an own-key path names the chosen provider only', () => {
    for (const [id, name] of [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['google', 'Google']] as const) {
      const c = aiConsentCopy(id, 'Nut AI', ['OpenRouter'])
      expect(c.title).toBe(`Send meal photos to ${name}?`)
      expect(c.body).toContain(`to ${name}, with your own key.`)
      expect(c.body).not.toContain('publik')
      expect(c.body).not.toContain('OpenRouter')
    }
  })
})
