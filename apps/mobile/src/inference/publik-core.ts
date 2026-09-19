import type { ScanFailure } from './pathA/client'
import { insufficientCreditMessage, linkButtonLabel } from './publik-copy'

/**
 * publik API — the pure half.
 *
 * No Expo imports, so Vitest runs it under `environment: 'node'` with a
 * scripted fetch (the `backup-core.ts` / `backup.ts` split). `publik.ts` is the
 * Expo binding: SecureStore, the kv-store and device facts.
 *
 * The contract this file speaks is publik's CONTRACT.md: `POST /installs`
 * mints a `pk_live_` key against a public app token; every metered response
 * carries `x-publik-*` headers with the balance; a 402 body names exactly one
 * link, `top_up_url`.
 */

export const PUBLIK_PROVIDER = 'publik' as const
export const PUBLIK_ORIGIN = 'https://publikhq.com'
export const PUBLIK_MODELS = { fast: 'publik-fast', balanced: 'publik-balanced', smart: 'publik-smart' } as const

/**
 * The committed placeholder. A build carrying it behaves as if publik API
 * did not exist: the onboarding card is hidden and the vendor picker is the
 * whole screen. Filling it is one commit (docs/PUBLIK-API.md).
 */
export const APP_TOKEN_PLACEHOLDER = 'pat_nut-ai_REPLACE_ME'
const APP_TOKEN_RE = /^pat_[a-z0-9-]+_[a-z0-9]{32}$/
const KEY_RE = /^pk_(live|test)_[a-z0-9]{12}_[a-z0-9]{32}$/

const PROVISION_TIMEOUT_MS = 15_000

export interface PublikBuildConfig {
  appToken: string
  appSlug: string
  baseUrl: string
  disclosureVersion: number
  /** Tier aliases by job. `scan` is a config default so it can be flipped
   *  to `publik-fast` once vision on the fast tier is verified. */
  models: { scan: string; text: string }
}

export function isUsableAppToken(token: unknown): token is string {
  return typeof token === 'string' && token !== APP_TOKEN_PLACEHOLDER && APP_TOKEN_RE.test(token)
}

/** What SecureStore holds for the publik slot, beside `key.publik`. */
export interface PublikInstall {
  installId: string
  claimUrl: string | null
  claimState: 'anonymous' | 'claimed'
  disclosureVersion: number
  models: { fast: string; balanced: string; smart?: string }
  baseUrl: string
}

/** Balance line, refreshed from response headers and GET /wallet. Micros = 1e-6 USD. */
export interface PublikWallet {
  balanceMicros: number | null
  weekUsedMicros: number | null
  weekBudgetMicros: number | null
  weekResetsAt: string | null
  starterRemainingMicros: number | null
  claimState: 'anonymous' | 'claimed'
  /** Links from the wallet body; always on publikhq.com or dropped. */
  claimUrl: string | null
  addCreditUrl: string | null
}

export interface ProvisionInput {
  cfg: PublikBuildConfig
  installId: string
  appVersion: string
  os: 'ios' | 'android'
  osVersion: string
  deviceName: string | null
}

export type ProvisionFailureKind = 'offline' | 'rate-limited' | 'token-revoked' | 'unavailable' | 'malformed' | 'replayed'

export type ProvisionResult =
  | { ok: true; key: string; install: PublikInstall; wallet: PublikWallet; starterMicros: number }
  | { ok: false; kind: ProvisionFailureKind; status?: number; retryAfterSec?: number }

/** Only publikhq.com links are ever handed to Linking.openURL. */
export function isSafePublikLink(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    return new URL(url).origin === PUBLIK_ORIGIN
  } catch {
    return false
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function provision(input: ProvisionInput, fetchImpl: typeof fetch = fetch): Promise<ProvisionResult> {
  const { cfg } = input
  if (!isUsableAppToken(cfg.appToken)) return { ok: false, kind: 'unavailable' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVISION_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/installs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_token: cfg.appToken,
        app_slug: cfg.appSlug,
        app_version: input.appVersion,
        os: input.os,
        os_version: input.osVersion,
        device_name: input.deviceName,
        install_id: input.installId,
        disclosure_version: cfg.disclosureVersion,
        // Chat Completions only: the Responses web_search tool is not sent on
        // publik mode (its surcharge is unmetered), so the dialect is not claimed.
        dialects: ['chat_completions'],
      }),
      signal: controller.signal,
    })
    if (res.status === 429) {
      return { ok: false, kind: 'rate-limited', status: 429, retryAfterSec: Number(res.headers?.get('retry-after')) || 60 }
    }
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'token-revoked', status: res.status }
    if (!res.ok) return { ok: false, kind: 'unavailable', status: res.status }
    let j: Record<string, any>
    try {
      j = (await res.json()) as Record<string, any>
    } catch {
      return { ok: false, kind: 'malformed', status: res.status }
    }
    // A 200 replay of a known install_id carries key:null (CONTRACT §3.2). A
    // phone that lost its keychain entry mints a fresh install_id once — the
    // caller's job, so it is a named outcome here rather than a guess.
    if (j.key == null && res.status === 200) return { ok: false, kind: 'replayed', status: 200 }
    if (typeof j.key !== 'string' || !KEY_RE.test(j.key)) return { ok: false, kind: 'malformed', status: res.status }
    const claimState = j.claim_state === 'claimed' ? 'claimed' : 'anonymous'
    const install: PublikInstall = {
      installId: input.installId,
      claimUrl: isSafePublikLink(j.claim_url) ? j.claim_url : null,
      claimState,
      disclosureVersion: cfg.disclosureVersion,
      models: { ...PUBLIK_MODELS, ...(j.models && typeof j.models === 'object' ? j.models : {}) },
      // The response's base_url wins over the compiled default (CONTRACT §1).
      baseUrl: typeof j.base_url === 'string' && isSafePublikLink(j.base_url) ? j.base_url : cfg.baseUrl,
    }
    const starterMicros = num(j.starter_micros) ?? num(j.starting_credit_micros) ?? 0
    const wallet = walletFromJson(j.wallet && typeof j.wallet === 'object' ? j.wallet : {}, claimState)
    if (wallet.balanceMicros == null) wallet.balanceMicros = num(j.balance_micros) ?? starterMicros
    if (wallet.claimUrl == null) wallet.claimUrl = install.claimUrl
    return { ok: true, key: j.key, install, wallet, starterMicros }
  } catch (e) {
    return { ok: false, kind: (e as Error)?.name === 'AbortError' ? 'unavailable' : 'offline' }
  } finally {
    clearTimeout(timer)
  }
}

/** GET /wallet body (and the `wallet` object inside the mint reply). */
export function walletFromJson(w: Record<string, any>, claimState: PublikWallet['claimState']): PublikWallet {
  return {
    balanceMicros: num(w.balance_micros),
    weekUsedMicros: num(w.week?.used_micros),
    weekBudgetMicros: num(w.week?.budget_micros),
    weekResetsAt: typeof w.week?.resets_at === 'string' ? w.week.resets_at : null,
    starterRemainingMicros: num(w.starter?.remaining_micros),
    claimState: w.claim_state === 'claimed' || w.claim_state === 'anonymous' ? w.claim_state : claimState,
    claimUrl: isSafePublikLink(w.claim_url) ? w.claim_url : null,
    addCreditUrl: isSafePublikLink(w.add_credit_url) ? w.add_credit_url : null,
  }
}

/** Every metered response carries the balance; read it without a second call (CONTRACT §1). */
/**
 * What a response's headers ACTUALLY named. A key is present only when its
 * header was, so a caller can tell "the gateway said nothing about the week
 * budget" (keep what you knew) from "the gateway said `none`" (there is no
 * budget any more — a lapsed plan must not linger on the settings card).
 * `null` is therefore a value here, not an absence.
 */
export type PublikWalletPatch = Partial<PublikWallet>

export function walletPatchFromHeaders(h: Headers): PublikWalletPatch {
  const num = (name: string): number | null => {
    const v = h.get(name)
    if (v == null || v === 'none') return null
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : null
  }
  const patch: PublikWalletPatch = {}

  if (h.has('x-publik-balance')) patch.balanceMicros = num('x-publik-balance')
  else if (h.has('x-publik-balance-micros')) patch.balanceMicros = num('x-publik-balance-micros')

  if (h.has('x-publik-week-used')) patch.weekUsedMicros = num('x-publik-week-used')
  if (h.has('x-publik-week-budget')) patch.weekBudgetMicros = num('x-publik-week-budget')
  const resets = h.get('x-publik-week-resets-at')
  if (resets != null) patch.weekResetsAt = resets

  // Sent only while the starter has something left (CONTRACT §1), so on a
  // metered response its ABSENCE is the news: the starter is spent.
  if (h.has('x-publik-request-id')) patch.starterRemainingMicros = num('x-publik-starter-remaining')

  const claim = h.get('x-publik-claim-state')
  if (claim === 'claimed' || claim === 'anonymous') patch.claimState = claim

  return patch
}

/** The same reading, resolved against a snapshot. */
export function walletFromHeaders(h: Headers, prev: PublikWallet): PublikWallet {
  return { ...prev, ...walletPatchFromHeaders(h) }
}

/** The settled charge for this call, in USD; null when the header is absent (streams). */
export function chargeUsdFromHeaders(h: Headers): number | null {
  const v = h.get('x-publik-charge-micros')
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n / 1_000_000 : null
}

export function isPublikResponse(h: Headers | undefined | null): h is Headers {
  return Boolean(h && typeof h.has === 'function' && h.has('x-publik-request-id'))
}

export function emptyWallet(claimState: PublikWallet['claimState'] = 'anonymous'): PublikWallet {
  return {
    balanceMicros: null,
    weekUsedMicros: null,
    weekBudgetMicros: null,
    weekResetsAt: null,
    starterRemainingMicros: null,
    claimState,
    claimUrl: null,
    addCreditUrl: null,
  }
}

export function formatMicros(m: number | null | undefined): string {
  if (m == null) return '—'
  const usd = m / 1_000_000
  return usd >= 0.01 || usd === 0 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

/** A publik credential is always the api_key shape. */
export function asCredential(key: string): { kind: 'api_key'; value: string } {
  return { kind: 'api_key', value: key }
}

/**
 * The gateway's error envelope → the app's six named failure states, with
 * the one link CONTRACT §1 allows on a 402: `top_up_url`. Returns null for a
 * body that is not a publik envelope, so vendor errors keep their own
 * classification.
 */
export function classifyGatewayError(status: number, body: string): ScanFailure | null {
  let e: Record<string, any> | null = null
  try {
    const parsed = JSON.parse(body)
    e = parsed?.error && typeof parsed.error === 'object' ? parsed.error : null
  } catch {
    return null
  }
  if (!e || typeof e.type !== 'string') return null
  const claimState: 'anonymous' | 'claimed' = e.claim_state === 'claimed' ? 'claimed' : 'anonymous'
  const topUp = isSafePublikLink(e.top_up_url)
    ? e.top_up_url
    : claimState === 'anonymous' && isSafePublikLink(e.claim_url)
      ? e.claim_url
      : isSafePublikLink(e.add_credit_url)
        ? e.add_credit_url
        : null
  const action = (label: string) => (topUp ? { action: { label, url: topUp } } : {})
  // The gateway's message carries the justification (CONTRACT §12.3); its
  // device noun is written for desktops, this is a phone.
  const serverMessage =
    typeof e.message === 'string' && e.message.trim() ? e.message.trim().replace(/\bthis computer\b/g, 'this phone') : null

  switch (e.type) {
    case 'insufficient_credit':
      return {
        kind: 'quota-exhausted',
        httpStatus: status,
        retryable: false,
        message: serverMessage ?? insufficientCreditMessage(claimState),
        ...action(linkButtonLabel(claimState)),
      }
    case 'daily_cap_reached':
      return {
        kind: 'quota-exhausted',
        httpStatus: status,
        retryable: false,
        message: "Today's publik API spending cap is reached. It resets at midnight UTC — or use your own key in Profile.",
        ...action(claimState === 'anonymous' ? linkButtonLabel('anonymous') : 'Raise the cap'),
      }
    case 'week_budget_reached':
      return {
        kind: 'quota-exhausted',
        httpStatus: status,
        retryable: false,
        message: "This week's publik API budget is used up. It comes back at the next weekly reset — or use your own key in Profile.",
        ...action(linkButtonLabel(claimState)),
      }
    case 'model_requires_claim':
      return {
        kind: 'model-unavailable',
        httpStatus: status,
        retryable: false,
        message: 'That model needs a linked publik account. Link this phone, or pick publik-balanced in Profile.',
        ...action(linkButtonLabel('anonymous')),
      }
    case 'key_revoked':
      return {
        kind: 'key-invalid',
        httpStatus: status,
        retryable: false,
        message: 'publik API is disconnected on this phone. Reconnect it in Profile, or use your own key.',
        ...(e.reprovision === true ? { reprovision: true } : {}),
      }
    case 'invalid_api_key':
      return {
        kind: 'key-invalid',
        httpStatus: status,
        retryable: false,
        message: "publik API rejected this phone's key. Reconnect it in Profile, or use your own key.",
      }
    case 'unknown_model':
      return {
        kind: 'model-unavailable',
        httpStatus: status,
        retryable: false,
        message: serverMessage ?? 'publik API does not know that model. Pick one in Profile → AI provider.',
      }
    case 'gateway_unavailable':
      return {
        kind: 'error-retryable',
        httpStatus: status,
        retryable: true,
        message: 'publik API is briefly unavailable. Try again in a moment — or use your own key in Profile.',
      }
    case 'rate_limit_exceeded':
      return {
        kind: 'error-retryable',
        httpStatus: status,
        retryable: true,
        message: 'publik API is rate-limiting. Try again shortly.',
      }
    default:
      return null
  }
}
