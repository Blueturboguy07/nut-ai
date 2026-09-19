import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The resolver against mocked stores: publik resolves to the OpenAI dialect
 * at the install's base URL with the config's scan model; a vendor setting is
 * untouched by any publik state; a chosen model is honoured everywhere.
 */

const settings = new Map<string, string>()
const creds = new Map<string, { kind: 'api_key' | 'oauth'; value: string }>()
let install: any = null

vi.mock('../data/repo', () => ({
  setting: async (k: string, fallback = '') => settings.get(k) ?? fallback,
}))
vi.mock('./credentials', () => ({
  loadCredential: async (slot: string) => creds.get(slot) ?? null,
}))
vi.mock('./publik', () => ({
  loadPublikInstall: async () => install,
  publikBuildConfig: () => ({
    appToken: 'pat_nut-ai_' + 'a'.repeat(32),
    appSlug: 'nut-ai',
    baseUrl: 'https://publikhq.com/api/v1',
    disclosureVersion: 1,
    models: { scan: 'publik-balanced', text: 'publik-fast' },
  }),
}))

import { baseUrlOf, lookupOptionsOf, resolveInference } from './resolve'

const INSTALL = { installId: 'i', claimUrl: 'https://publikhq.com/claim/A', claimState: 'anonymous', disclosureVersion: 1, models: { fast: 'publik-fast', balanced: 'publik-balanced' }, baseUrl: 'https://publikhq.com/api/v1' }

beforeEach(() => {
  settings.clear()
  creds.clear()
  install = null
})

describe('resolveInference', () => {
  it('no provider → no-key', async () => {
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'no-key' } })
    settings.set('provider', 'none')
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'no-key' } })
  })

  it('publik with key + install → OpenAI dialect at the install base URL, metered, no web search', async () => {
    settings.set('provider', 'publik')
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    install = { ...INSTALL, baseUrl: 'https://publikhq.com/api/v2' }
    const r = await resolveInference()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.dialect).toBe('openai')
      expect(r.value.selected).toBe('publik')
      expect(r.value.model).toBe('publik-balanced')
      expect(r.value.textModel).toBe('publik-fast')
      expect(r.value.baseUrl).toBe('https://publikhq.com/api/v2')
      expect(r.value.metered).toBe(true)
      expect(r.value.webSearch).toBe(false)
      expect(r.value.credential).toEqual({ kind: 'api_key', value: 'pk_x' })
      expect(baseUrlOf(r.value)).toEqual({ baseUrl: 'https://publikhq.com/api/v2' })
      expect(lookupOptionsOf(r.value)).toEqual({ baseUrl: 'https://publikhq.com/api/v2', webSearch: false })
    }
  })

  it('publik without a key, or without an install, → publik-disconnected', async () => {
    settings.set('provider', 'publik')
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'publik-disconnected' } })
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'publik-disconnected' } })
  })

  it('a chosen provider_model is honoured on publik', async () => {
    settings.set('provider', 'publik')
    settings.set('provider_model', 'publik-fast')
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    install = INSTALL
    const r = await resolveInference()
    expect(r.ok && r.value.model).toBe('publik-fast')
  })

  it('a vendor setting is untouched by publik state', async () => {
    settings.set('provider', 'openai')
    creds.set('openai', { kind: 'api_key', value: 'sk-vendor' })
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    install = INSTALL
    const r = await resolveInference()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.dialect).toBe('openai')
      expect(r.value.selected).toBe('openai')
      expect(r.value.model).toBe('gpt-4o-mini')
      expect(r.value.textModel).toBe('gpt-4o-mini')
      expect(r.value.baseUrl).toBeUndefined()
      expect(r.value.metered).toBe(false)
      expect(r.value.webSearch).toBe(true)
      expect(r.value.credential.value).toBe('sk-vendor')
      expect(baseUrlOf(r.value)).toEqual({})
      expect(lookupOptionsOf(r.value)).toEqual({})
    }
  })

  it('a vendor setting with no key → key-missing', async () => {
    settings.set('provider', 'anthropic')
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'key-missing' } })
  })
})
