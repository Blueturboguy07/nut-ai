import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The resolver against mocked stores: publik resolves to the OpenAI dialect
 * at the install's base URL with the config's scan model; a vendor setting is
 * untouched by any publik state; a chosen model is honoured everywhere.
 */

const settings = new Map<string, string>()
const creds = new Map<string, { kind: 'api_key' | 'oauth'; value: string }>()
let install: any = null
// The dev-build flag (Claude subscription tokens) and the consent answers, per test.
const h = vi.hoisted(() => ({ dev: true, consent: true, asked: [] as string[] }))

vi.mock('../build-flags', () => ({
  get CLAUDE_SUBSCRIPTION_TOKENS() {
    return h.dev
  },
}))
vi.mock('./ai-consent', () => ({
  ensureAiConsent: async (d: string) => {
    h.asked.push(d)
    return h.consent
  },
}))
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
    models: { scan: 'publik-fast', text: 'publik-fast' },
  }),
}))

import { baseUrlOf, lookupOptionsOf, publikScanModelSetting, resolveInference } from './resolve'

const INSTALL = { installId: 'i', claimUrl: 'https://publikhq.com/claim/A', claimState: 'anonymous', disclosureVersion: 1, models: { fast: 'publik-fast', balanced: 'publik-balanced' }, baseUrl: 'https://publikhq.com/api/v1' }

beforeEach(() => {
  settings.clear()
  creds.clear()
  install = null
  h.dev = true
  h.consent = true
  h.asked = []
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
      expect(r.value.model).toBe('publik-fast')
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

  it('a model picked in Profile is honoured on publik — publik-balanced included', async () => {
    settings.set('provider', 'publik')
    settings.set('publik_model_pick', 'publik-balanced')
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    install = INSTALL
    const r = await resolveInference()
    expect(r.ok && r.value.model).toBe('publik-balanced')
    expect(await publikScanModelSetting()).toBe('publik-balanced')
  })

  /**
   * Nov 1 2026: builds up to 71ee482 wrote the then-default publik-balanced
   * into provider_model at connect time, and the resolver preferred that slot
   * over publik-build.json. A phone rebuilt from the fix kept the reasoning
   * tier: 72 s and $0.067 a scan, measured through the gateway.
   */
  it('a phone connected on an old build (provider_model = publik-balanced, no pick) follows the build default', async () => {
    settings.set('provider', 'publik')
    settings.set('provider_model', 'publik-balanced')
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    install = INSTALL
    const r = await resolveInference()
    expect(r.ok && r.value.model).toBe('publik-fast')
    expect(await publikScanModelSetting()).toBe('publik-fast')
  })

  it('any other publik tier in the old slot was a Profile tap and is kept', async () => {
    settings.set('provider', 'publik')
    settings.set('provider_model', 'publik-smart')
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    install = INSTALL
    const r = await resolveInference()
    expect(r.ok && r.value.model).toBe('publik-smart')
  })

  it('a vendor model left in provider_model, or junk in the pick, never reaches the gateway', async () => {
    settings.set('provider', 'publik')
    settings.set('provider_model', 'gpt-4o-mini')
    settings.set('publik_model_pick', 'claude-x')
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

describe('consent and the App Store build', () => {
  it('nothing goes to an AI provider the person did not agree to: publik and each vendor are asked on their own', async () => {
    h.consent = false
    settings.set('provider', 'publik')
    creds.set('publik', { kind: 'api_key', value: 'pk_x' })
    install = INSTALL
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'consent-declined' } })
    settings.set('provider', 'openai')
    creds.set('openai', { kind: 'api_key', value: 'sk-vendor' })
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'consent-declined' } })
    expect(h.asked).toEqual(['publik', 'openai'])
  })

  it('no key, no question: the consent is asked only when a call could be made', async () => {
    settings.set('provider', 'anthropic')
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'key-missing' } })
    expect(h.asked).toEqual([])
  })

  it('every build but a dev build refuses a saved Claude CLI token (Android too); an API key works as before', async () => {
    h.dev = false
    settings.set('provider', 'anthropic')
    creds.set('anthropic', { kind: 'oauth', value: 'sk-ant-oat01-x' })
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'key-missing' } })
    expect(h.asked).toEqual([])
    creds.set('anthropic', { kind: 'api_key', value: 'sk-ant-api03-x' })
    const r = await resolveInference()
    expect(r.ok && r.value.credential).toEqual({ kind: 'api_key', value: 'sk-ant-api03-x' })
    h.dev = true
    creds.set('anthropic', { kind: 'oauth', value: 'sk-ant-oat01-x' })
    expect((await resolveInference()).ok).toBe(true)
  })
})
