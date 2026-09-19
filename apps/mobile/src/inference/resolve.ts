import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { setting } from '../data/repo'
import { loadCredential } from './credentials'
import type { Credential } from './pathA/client'
import { loadPublikInstall, publikBuildConfig } from './publik'
import { asCredential } from './publik-core'

/**
 * One resolver for every call site that used to read `provider`,
 * `loadCredential` and `provider_model` by hand.
 *
 * `publik` is a fourth PROVIDER SETTING, not a fourth dialect: `ProviderId`
 * in @nutai/prompt names a wire format, and publik API speaks the OpenAI
 * one. So the resolver turns the setting into `{ dialect: 'openai', baseUrl,
 * credential, model }` and every `provider === 'openai'` branch downstream
 * works unchanged.
 *
 * A user-entered key always wins: publik code never reads, writes or clears
 * the three vendor slots, and the vendor branch below is exactly what it was.
 */

export type ProviderSetting = ProviderId | 'publik' | 'none' | ''

export interface Resolved {
  /** The wire dialect the builders and the envelope extractor use. */
  dialect: ProviderId
  /** What the user chose; drives copy and the settings UI. */
  selected: ProviderId | 'publik'
  /** The photo-scan model. */
  model: string
  /** The model for text-only calls (exercise estimate, web lookup). */
  textModel: string
  credential: Credential
  baseUrl?: string
  /** True when the gateway's x-publik-* headers are authoritative for cost. */
  metered: boolean
  /** False on publik: the Responses web_search tool is not sent (unmetered there). */
  webSearch: boolean
}

export type ResolveFailure = { kind: 'no-key' | 'key-missing' | 'publik-disconnected' }

export type ResolveOutcome = { ok: true; value: Resolved } | { ok: false; error: ResolveFailure }

export async function resolveInference(): Promise<ResolveOutcome> {
  const provider = (await setting('provider')) as ProviderSetting
  if (!provider || provider === 'none') return { ok: false, error: { kind: 'no-key' } }

  if (provider === 'publik') {
    const [cred, install] = await Promise.all([loadCredential('publik'), loadPublikInstall()])
    if (!cred || !install) return { ok: false, error: { kind: 'publik-disconnected' } }
    const cfg = publikBuildConfig()
    const model = (await setting('provider_model')) || cfg.models.scan
    return {
      ok: true,
      value: {
        dialect: 'openai',
        selected: 'publik',
        model,
        textModel: cfg.models.text,
        credential: asCredential(cred.value),
        baseUrl: install.baseUrl,
        metered: true,
        webSearch: false,
      },
    }
  }

  const credential = await loadCredential(provider)
  if (!credential) return { ok: false, error: { kind: 'key-missing' } }
  const model = (await setting('provider_model')) || cheapestModel(provider).id
  return { ok: true, value: { dialect: provider, selected: provider, model, textModel: model, credential, metered: false, webSearch: true } }
}

/** `exactOptionalPropertyTypes`: spread, never pass `baseUrl: undefined`. */
export function baseUrlOf(r: Resolved): { baseUrl?: string } {
  return r.baseUrl ? { baseUrl: r.baseUrl } : {}
}

/** The options a web lookup takes from the resolution. */
export function lookupOptionsOf(r: Resolved): { baseUrl?: string; webSearch?: boolean } {
  return { ...baseUrlOf(r), ...(r.webSearch ? {} : { webSearch: false }) }
}
