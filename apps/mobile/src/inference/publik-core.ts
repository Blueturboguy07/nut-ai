import type { ScanFailure } from './pathA/client'
import { startDeadline } from './deadline'
import { APP_NAME, insufficientCreditMessage, linkButtonLabel, waitPhrase } from './publik-copy'

/**
 * publik API and Sign in with publik — the pure half of the publik module.
 *
 * No Expo imports, so Vitest runs it under `environment: 'node'` with a
 * scripted fetch (the `backup-core.ts` / `backup.ts` split). `publik.ts` is the
 * Expo binding: SecureStore, the kv-store, device facts and the launch values.
 *
 * The contract this file speaks is publik's CONTRACT.md: `POST /installs`
 * mints a `pk_live_` key against a public app token; every metered response
 * carries `x-publik-*` headers with the balance; a 402 body names exactly one
 * link, `top_up_url`. The gate at the end of the file is publikhq.com's
 * publik module (sdk/publik.ts.md) on a phone: Sign in with publik, the plan
 * choice, and usage counting (POST /api/v1/telemetry).
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
/** Any `pat_` token but the placeholder: publik checks the token itself, and a new token shape must not lock a build out. */
const APP_TOKEN_RE = /^pat_[A-Za-z0-9_-]{8,200}$/
/** A `pk_` key. The server decides whether it is good; a test publik may use a short one. */
const KEY_RE = /^pk_[A-Za-z0-9_]{6,200}$/

const PROVISION_TIMEOUT_MS = 15_000
/**
 * The revoke on disconnect and the wallet read. On Android the network stack
 * has no timeout of its own (OkHttp timeouts 0), so without this a call that
 * gets no answer would hold Disconnect or the wallet card forever.
 */
export const ACCOUNT_CALL_TIMEOUT_MS = 15_000

export interface PublikBuildConfig {
  appToken: string
  appSlug: string
  baseUrl: string
  disclosureVersion: number
  /** Tier aliases by job. `scan` is the build's default for photos; a
   *  phone follows it unless its owner picked a tier in Profile
   *  (`publikScanModel`). publik-fast since Nov 2026 (docs/PUBLIK-API.md). */
  models: { scan: string; text: string }
}

/**
 * The setting a tap in Profile's publik model list writes — and nothing
 * else does. Connecting publik (onboarding or Profile) leaves it empty, so
 * the phone follows the build's `models.scan`.
 */
export const PUBLIK_MODEL_PICK_SETTING = 'publik_model_pick'

/**
 * What builds before Nov 2026 wrote into `provider_model` by themselves when
 * a phone connected publik: the then-default, not a choice.
 */
const OLD_AUTO_SCAN_MODEL = PUBLIK_MODELS.balanced

function isPublikTier(m: string): boolean {
  return (Object.values(PUBLIK_MODELS) as string[]).includes(m)
}

/**
 * The photo-scan model a publik phone uses.
 *
 * 1. A tier picked in Profile (`publik_model_pick`) wins.
 * 2. Else a publik tier in the legacy `provider_model` slot, EXCEPT
 *    `publik-balanced`: builds up to 71ee482 wrote that value there at
 *    connect time, so it is the old default, not a pick. A phone built at
 *    71ee482 and rebuilt kept the reasoning tier — 72 s and $0.067 a scan
 *    (Nov 1 2026) — if this slot won. Any other tier there was a Profile tap.
 * 3. Else the build's `models.scan`.
 */
export function publikScanModel(cfg: Pick<PublikBuildConfig, 'models'>, pick: string, legacyProviderModel: string): string {
  if (isPublikTier(pick)) return pick
  if (isPublikTier(legacyProviderModel) && legacyProviderModel !== OLD_AUTO_SCAN_MODEL) return legacyProviderModel
  return cfg.models.scan
}

export function isUsableAppToken(token: unknown): token is string {
  return typeof token === 'string' && token !== APP_TOKEN_PLACEHOLDER && APP_TOKEN_RE.test(token)
}

/** The answer to the gate's plan screen: publik API (Connect your plan), or the person's own key. */
export type Choice = 'publik' | 'own_key'

/** What SecureStore holds for the publik slot, beside `key.publik`. */
export interface PublikInstall {
  installId: string
  claimUrl: string | null
  claimState: 'anonymous' | 'claimed'
  disclosureVersion: number
  models: { fast: string; balanced: string; smart?: string }
  baseUrl: string
  /** The plan choice of the gate; null or absent asks again at the next start. */
  choice?: Choice | null
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

/**
 * The one other origin whose links count as publik's: the build's own base
 * URL when it is not publikhq.com (PUBLIK_API_BASE_URL at launch, the blind
 * test's fake publik, or a dev build's preview gateway). Set by publik.ts.
 */
let configuredOrigin: string | null = null
export function allowPublikOrigin(baseUrl: string | null): void {
  try {
    const origin = baseUrl ? new URL(baseUrl).origin : null
    configuredOrigin = origin && origin !== PUBLIK_ORIGIN ? origin : null
  } catch {
    configuredOrigin = null
  }
}

/** Only publikhq.com links (or the configured publik's) are ever handed to Linking.openURL. */
export function isSafePublikLink(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const origin = new URL(url).origin
    return origin === PUBLIK_ORIGIN || (configuredOrigin !== null && origin === configuredOrigin)
  } catch {
    return false
  }
}

/** `https://publikhq.com` from `https://publikhq.com/api/v1` (also a base URL given without `/api/v1`). */
export function originOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function provision(input: ProvisionInput, fetchImpl: typeof fetch = fetch): Promise<ProvisionResult> {
  const { cfg } = input
  if (!isUsableAppToken(cfg.appToken)) return { ok: false, kind: 'unavailable' }
  const deadline = startDeadline(PROVISION_TIMEOUT_MS)
  try {
    const res = await deadline.within(
      fetchImpl(`${originOf(cfg.baseUrl)}${INSTALLS_PATH}`, {
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
        signal: deadline.signal,
      }),
    )
    if (res.status === 429) {
      return { ok: false, kind: 'rate-limited', status: 429, retryAfterSec: Number(res.headers?.get('retry-after')) || 60 }
    }
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'token-revoked', status: res.status }
    if (!res.ok) return { ok: false, kind: 'unavailable', status: res.status }
    let j: Record<string, any>
    try {
      j = (await deadline.within(res.json())) as Record<string, any>
    } catch {
      // The deadline can fire while the answer is read: that is no answer,
      // not an answer this build cannot parse ("Update Nut AI"). `within`
      // gives up at the deadline also when the phone's json() never settles
      // (iOS) or throws on the cut body (Android); see ./deadline.
      return { ok: false, kind: deadline.timedOut ? 'unavailable' : 'malformed', status: res.status }
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
  } catch {
    // The deadline's own state, not the error's name: on a phone an aborted
    // fetch rejects with expo's FetchError (see ./deadline).
    return { ok: false, kind: deadline.timedOut ? 'unavailable' : 'offline' }
  } finally {
    deadline.clear()
  }
}

/**
 * POST /installs/revoke for Disconnect. Best effort: the caller forgets the
 * key either way, and the server's idle sweep revokes a key it never heard
 * from. Gives up after ACCOUNT_CALL_TIMEOUT_MS.
 */
export async function revokeInstall(
  baseUrl: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'revoked' | 'refused' | 'timed-out' | 'offline'> {
  const deadline = startDeadline(ACCOUNT_CALL_TIMEOUT_MS)
  try {
    const res = await deadline.within(
      fetchImpl(`${baseUrl.replace(/\/+$/, '')}/installs/revoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        signal: deadline.signal,
      }),
    )
    return res.ok ? 'revoked' : 'refused'
  } catch {
    return deadline.timedOut ? 'timed-out' : 'offline'
  } finally {
    deadline.clear()
  }
}

/**
 * GET /wallet → snapshot, or null when publik refused, did not answer within
 * ACCOUNT_CALL_TIMEOUT_MS (the body read included), or answered nonsense.
 */
export async function fetchWallet(
  baseUrl: string,
  key: string,
  claimState: PublikWallet['claimState'],
  fetchImpl: typeof fetch = fetch,
): Promise<PublikWallet | null> {
  const deadline = startDeadline(ACCOUNT_CALL_TIMEOUT_MS)
  try {
    const res = await deadline.within(
      fetchImpl(`${baseUrl.replace(/\/+$/, '')}/wallet`, {
        headers: { authorization: `Bearer ${key}` },
        signal: deadline.signal,
      }),
    )
    if (!res.ok) return null
    return walletFromJson((await deadline.within(res.json())) as Record<string, any>, claimState)
  } catch {
    return null
  } finally {
    deadline.clear()
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
        message: 'That model needs a linked publik account. Link this phone, or pick publik-fast in Profile.',
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

// ---------------------------------------------------------------------------
// Sign in with publik: the gate, usage counting and the self-test
// ---------------------------------------------------------------------------
//
// publikhq.com's publik module (sdk/publik.ts.md) on a phone. Every app on
// publik opens with Sign in with publik; this is that gate, with the same
// screens, words and endpoints. At start, before any screen of the app,
// `ensureSignedIn(ui, device)`:
//   1. loads or provisions this phone's publik key (POST /api/v1/installs);
//   2. shows Sign in with publik until GET /api/v1/wallet says "claimed" (no
//      other way past it);
//   3. asks once how the app pays for AI and stores the answer;
//   4. starts usage counting: app_opened now, active_session every 30
//      minutes (POST /api/v1/telemetry).
// What a phone changes: the key and the choice live in SecureStore
// (`key.publik`, `publik.install`), not in a credential file; "Sign in with
// publik" opens the claim link in the system browser, and the gate checks
// GET /wallet every 3 s while the app is in the foreground and at once when
// the person comes back from the browser; the switches (PUBLIK_SELF_TEST,
// DO_NOT_TRACK, PUBLIK_API_BASE_URL...) are launch values: an environment
// variable or a launch argument (modules/publik-launch). publik.ts gives the
// gate the phone as a GateDevice.

/** The listing slug (publikhq.com/nut-ai). The publik scan reads this literal. */
export const APP_SLUG = 'nut-ai'
/** The release version. app.config.ts says the same; a test checks it. */
export const APP_VERSION = '0.1.1'
/** Nut AI calls a model (photo scans, labels, lookups), so the gate asks how to pay for AI. */
export const USES_AI: boolean = true
export const POLL_MS = 3_000
export const POLL_LIMIT_MS = 10 * 60_000
/** active_session: every 30 minutes while the app runs. */
export const TELEMETRY_INTERVAL_SECONDS = 1_800
export const INSTALLS_PATH = '/api/v1/installs'
export const WALLET_PATH = '/api/v1/wallet'
export const TELEMETRY_PATH = '/api/v1/telemetry'
export const UNREACHABLE_MESSAGE = 'publik is not reachable. Check your connection.'

export interface GateWallet {
  claimState: 'anonymous' | 'claimed'
  claimUrl: string | null
  handle: string | null
  plan: { kind: 'none' | 'plan' | 'pack'; label: string | null }
  balanceMicros: number
  topUpUrl: string | null
}
export type GateAction = 'sign_in' | 'retry' | 'get_plan' | 'connect' | 'own_key'
export interface GateScreen {
  id: 'sign_in' | 'unreachable' | 'choose'
  title: string
  body: string
  note: string | null
  buttons: { action: GateAction; label: string }[]
}
/** show(): draw the screen and resolve with the button pressed. When `signal` aborts, the gate has moved on (the promise may stay pending). */
export interface GateUI {
  show(screen: GateScreen, signal: AbortSignal): Promise<GateAction>
  openUrl(url: string): void
}
export interface GateResult {
  key: string
  wallet: GateWallet
  choice: Choice | null
  /** True when the person answered the plan screen in this run (not a stored answer). */
  chosen: boolean
}

/** The phone, as the gate needs it. publik.ts builds the real one; the tests build a fake. */
export interface GateDevice {
  cfg: PublikBuildConfig
  os: 'ios' | 'android'
  fetch: typeof fetch
  /** The stored key, its claim link and the plan choice; null when this phone holds no key. */
  load: () => Promise<{ key: string; claimUrl: string | null; choice: Choice | null } | null>
  /** POST /api/v1/installs and store the key (publik.ts connectPublik). */
  provision: () => Promise<ProvisionResult>
  /** Forget a key that publik does not know any more (401). */
  forget: () => Promise<void>
  saveChoice: (choice: Choice) => Promise<void>
  /** Keep the settings card's wallet snapshot in step with the gate's GET /wallet. */
  noteWallet: (snapshot: PublikWallet) => Promise<void>
  /**
   * Wait `ms` of foreground time (null: no timer). Resolves 'resumed' at once
   * when the app comes back to the foreground, and 'timer' when `signal` aborts.
   */
  wait: (ms: number | null, signal: AbortSignal) => Promise<'timer' | 'resumed'>
  /** A launch value: an environment variable or a launch argument. */
  value: (name: string) => string | null
  /** The self-test: one line on stdout, then the app exits. */
  printAndExit: (line: string) => void
  /** One random UUID for this app on this phone (telemetry only). */
  telemetryInstallId: () => Promise<string>
  log: (line: string) => void
}

/** GET /wallet answered, but without a body the gate can read. */
export interface WalletRead {
  status: number
  wallet: GateWallet | null
  snapshot: PublikWallet | null
  message: string | null
}

/** No answer from publik: no connection, or no answer within ACCOUNT_CALL_TIMEOUT_MS. */
export class PublikUnreachable extends Error {
  constructor() {
    super(UNREACHABLE_MESSAGE)
    this.name = 'PublikUnreachable'
  }
}

export function gateWalletFromJson(b: Record<string, any>): GateWallet {
  const kind = b.plan?.kind === 'plan' || b.plan?.kind === 'pack' ? (b.plan.kind as 'plan' | 'pack') : 'none'
  return {
    claimState: b.claim_state === 'claimed' ? 'claimed' : 'anonymous',
    claimUrl: isSafePublikLink(b.claim_url) ? b.claim_url : null,
    handle: typeof b.account?.handle === 'string' && b.account.handle ? b.account.handle : null,
    plan: { kind, label: typeof b.plan?.label === 'string' ? b.plan.label : null },
    balanceMicros: num(b.balance_micros) ?? 0,
    topUpUrl: isSafePublikLink(b.top_up_url) ? b.top_up_url : null,
  }
}

/** GET /api/v1/wallet with the install key. Throws PublikUnreachable when publik does not answer. */
export async function readWallet(d: Pick<GateDevice, 'cfg' | 'fetch'>, key: string): Promise<WalletRead> {
  const deadline = startDeadline(ACCOUNT_CALL_TIMEOUT_MS)
  try {
    let res: Response
    try {
      res = await deadline.within(
        d.fetch(`${originOf(d.cfg.baseUrl)}${WALLET_PATH}`, { headers: { authorization: `Bearer ${key}` }, signal: deadline.signal }),
      )
    } catch {
      throw new PublikUnreachable()
    }
    let b: Record<string, any> = {}
    try {
      const parsed = await deadline.within(res.json())
      if (parsed && typeof parsed === 'object') b = parsed as Record<string, any>
    } catch {
      if (deadline.timedOut) throw new PublikUnreachable()
    }
    if (!res.ok || typeof b.claim_state !== 'string') {
      return { status: res.status, wallet: null, snapshot: null, message: typeof b.error?.message === 'string' ? b.error.message : null }
    }
    const wallet = gateWalletFromJson(b)
    return { status: res.status, wallet, snapshot: walletFromJson(b, wallet.claimState), message: null }
  } finally {
    deadline.clear()
  }
}

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`
const SIGN_IN_WAITING = 'Waiting for you to sign in in your browser.'
const SIGN_IN_TIMEOUT = 'No sign-in after 10 minutes. Click Sign in with publik to try again.'
const PLAN_WAITING = 'Waiting for your plan. Finish in your browser.'
const PLAN_TIMEOUT = 'No plan after 10 minutes. Click Get a plan to try again.'

/** The words of the gate. The same in every publik module. */
export function gateScreen(id: GateScreen['id'], w: GateWallet | null, note: string | null = null, message?: string): GateScreen {
  if (id === 'unreachable') {
    return { id, title: 'Sign in with publik', body: message ?? UNREACHABLE_MESSAGE, note, buttons: [{ action: 'retry', label: 'Retry' }] }
  }
  if (id === 'sign_in') {
    return {
      id,
      title: 'Sign in with publik',
      note,
      buttons: [{ action: 'sign_in', label: 'Sign in with publik' }],
      body: 'This app uses your publik account. Click Sign in with publik, then sign in in your browser. This window continues when you are signed in.',
    }
  }
  const who = w?.handle ? `You are signed in as @${w.handle}.` : 'You are signed in to publik.'
  if (!w || (w.plan.kind === 'none' && w.balanceMicros === 0)) {
    return {
      id,
      title: 'Choose how to pay for AI',
      note,
      body: `${who} This app uses AI. Get a publik plan, or use your own key.`,
      buttons: [
        { action: 'get_plan', label: 'Get a plan' },
        { action: 'own_key', label: 'Use my own key' },
      ],
    }
  }
  const what = w.plan.kind === 'plan' ? `Your plan: ${w.plan.label ?? 'publik'}.` : `Your balance: ${dollars(w.balanceMicros)}.`
  return {
    id,
    title: 'Connect your plan',
    note,
    body: `${who} ${what} Connect it to use AI in this app, or use your own key.`,
    buttons: [
      { action: 'connect', label: 'Connect your plan' },
      { action: 'own_key', label: 'Use my own key' },
    ],
  }
}

/** Why POST /installs did not give this phone a key, for the gate's Retry screen; undefined: publik did not answer. */
export function provisionGateMessage(p: Extract<ProvisionResult, { ok: false }>, cfg: Pick<PublikBuildConfig, 'appToken'>): string | undefined {
  if (!isUsableAppToken(cfg.appToken)) return 'This build has no publik app token. Ask the developer for a new build.'
  switch (p.kind) {
    case 'offline':
      return undefined
    case 'token-revoked':
      return 'This app token is not valid. Ask the developer for a new build.'
    case 'rate-limited':
      return `Too many phones on this network signed in to publik in the last hour. Try again in ${waitPhrase(p.retryAfterSec)}.`
    case 'replayed':
    case 'malformed':
      return `publik answered in a shape this build does not understand. Update ${APP_NAME}.`
    default:
      return p.status ? `publik could not set up this phone (${p.status}).` : undefined
  }
}

interface Watch {
  key: string
  until: (w: GateWallet) => boolean
  /** true: check every 3 s for at most 10 minutes. false: check only when the app comes back to the foreground. */
  poll: boolean
}

/** Show a screen; with `watch`, also check GET /wallet. "done": the check saw it; "timeout": 10 minutes passed. */
async function ask(ui: GateUI, screen: GateScreen, d: GateDevice, watch?: Watch): Promise<GateAction | 'done' | 'timeout'> {
  const stop = new AbortController()
  const watcher = async (w: Watch): Promise<'done' | 'timeout'> => {
    const end = Date.now() + POLL_LIMIT_MS
    for (;;) {
      await d.wait(w.poll ? POLL_MS : null, stop.signal)
      if (stop.signal.aborted) return 'timeout'
      const seen = await readWallet(d, w.key).then(
        (r) => r.wallet,
        () => null,
      )
      if (stop.signal.aborted) return 'timeout'
      if (seen && w.until(seen)) return 'done'
      if (w.poll && Date.now() >= end) return 'timeout'
    }
  }
  try {
    return await Promise.race([ui.show(screen, stop.signal), ...(watch ? [watcher(watch)] : [])])
  } finally {
    stop.abort()
  }
}

/** The gate (see the top of this section). Resolves once the person is signed in; `choice` is null when USES_AI is false. */
export async function ensureSignedIn(ui: GateUI, d: GateDevice): Promise<GateResult> {
  if (d.value('PUBLIK_SELF_TEST')) {
    d.printAndExit(await selfTest(d))
    return new Promise<GateResult>(() => {})
  }
  const origin = originOf(d.cfg.baseUrl)
  let signNote: string | null = null
  let signPoll = true
  let planNote: string | null = null
  let planPoll = false
  let refused = 0
  for (;;) {
    let stored = await d.load()
    if (!stored) {
      const p = await d.provision()
      if (!p.ok) {
        await ask(ui, gateScreen('unreachable', null, null, provisionGateMessage(p, d.cfg)), d)
        continue
      }
      stored = await d.load()
      if (!stored) {
        await ask(ui, gateScreen('unreachable', null, null, `This phone could not keep its publik key. Restart ${APP_NAME} and try again.`), d)
        continue
      }
    }
    let r: WalletRead
    try {
      r = await readWallet(d, stored.key)
    } catch {
      await ask(ui, gateScreen('unreachable', null), d)
      continue
    }
    if (r.status === 401) {
      // The key is gone (revoked): forget it and provision again, once; a
      // second 401 in a row waits for Retry instead of looping.
      await d.forget()
      refused += 1
      if (refused < 2) continue
      refused = 0
      await ask(ui, gateScreen('unreachable', null, null, r.message ?? 'publik did not accept the key of this phone.'), d)
      continue
    }
    refused = 0
    const w = r.wallet
    if (!w) {
      await ask(ui, gateScreen('unreachable', null, null, r.message ?? undefined), d)
      continue
    }
    if (r.snapshot) await d.noteWallet(r.snapshot).catch(() => undefined)
    if (w.claimState !== 'claimed') {
      const a = await ask(ui, gateScreen('sign_in', w, signNote), d, { key: stored.key, until: (x) => x.claimState === 'claimed', poll: signPoll })
      if (a === 'sign_in') {
        ui.openUrl(w.claimUrl ?? stored.claimUrl ?? `${origin}/wallet`)
        signNote = SIGN_IN_WAITING
        signPoll = true
      }
      if (a === 'timeout') {
        signNote = SIGN_IN_TIMEOUT
        signPoll = false
      }
      continue
    }
    let choice: Choice | null = USES_AI ? stored.choice : null
    let chosen = false
    if (USES_AI && !choice) {
      if (w.plan.kind !== 'none' || w.balanceMicros > 0) {
        // The plan is there: Connect your plan.
        planNote = null
        planPoll = false
      }
      const a = await ask(
        ui,
        gateScreen('choose', w, planNote),
        d,
        planPoll ? { key: stored.key, until: (x) => x.plan.kind !== 'none' || x.balanceMicros > 0, poll: true } : undefined,
      )
      planNote = null
      planPoll = false
      if (a === 'get_plan') {
        ui.openUrl(w.topUpUrl ?? `${origin}/wallet`)
        planNote = PLAN_WAITING
        planPoll = true
      }
      if (a === 'timeout') planNote = PLAN_TIMEOUT
      // "done": the plan is there; the next screen is Connect your plan.
      if (a !== 'connect' && a !== 'own_key') continue
      choice = a === 'connect' ? 'publik' : 'own_key'
      await d.saveChoice(choice)
      chosen = true
    }
    startTelemetry(d)
    return { key: stored.key, wallet: w, choice, chosen }
  }
}

/** Builder check, run by the BUILT app: PUBLIK_SELF_TEST=1 makes ensureSignedIn() print this line and exit. */
export async function selfTest(d: GateDevice): Promise<string> {
  try {
    const p = await d.provision()
    if (!p.ok) return `publik self-test: failed: ${provisionGateMessage(p, d.cfg) ?? UNREACHABLE_MESSAGE}`
    const r = await readWallet(d, p.key)
    if (!r.wallet) return `publik self-test: failed: ${r.message ?? `GET /wallet answered ${r.status}`}`
    return `publik self-test: ok ${APP_SLUG} ${APP_VERSION}`
  } catch (e) {
    return `publik self-test: failed: ${e instanceof PublikUnreachable ? UNREACHABLE_MESSAGE : e instanceof Error ? e.message : String(e)}`
  }
}

// ---------- usage counting: publikhq.com/skills/telemetry.md sections 3-5 ----------

let telemetryTimer: ReturnType<typeof setInterval> | null = null

/** Off with DO_NOT_TRACK (anything but empty, 0 or false) or PUBLIK_TELEMETRY=0/false/off. */
export function usageOff(value: (name: string) => string | null): boolean {
  const dnt = (value('DO_NOT_TRACK') ?? '').trim().toLowerCase()
  if (dnt !== '' && dnt !== '0' && dnt !== 'false') return true
  return ['0', 'false', 'off'].includes((value('PUBLIK_TELEMETRY') ?? '').trim().toLowerCase())
}

/**
 * One event, with the install key: send and forget. No content, no health
 * data, no user name. Every failure stays here; the person never sees one.
 * publik counts macos, windows and linux in v1, so it answers 400 to a
 * phone's os today and starts counting phones without an app update.
 */
export async function sendEvent(d: GateDevice, event: 'app_opened' | 'active_session'): Promise<void> {
  const say = (result: unknown) => {
    if (d.value('PUBLIK_TELEMETRY_DEBUG') === '1') d.log(`publik-telemetry: ${event} -> ${String(result)}`)
  }
  try {
    if (usageOff((name) => d.value(name))) return say('off (opt-out)')
    const key = (await d.load())?.key
    const body = { v: 1, app: APP_SLUG, install_id: await d.telemetryInstallId(), event, app_version: APP_VERSION.replace(/^v/i, ''), os: d.os }
    const deadline = startDeadline(5_000)
    try {
      const res = await deadline.within(
        d.fetch(`${originOf(d.cfg.baseUrl)}${TELEMETRY_PATH}`, {
          method: 'POST',
          signal: deadline.signal,
          headers: { 'content-type': 'application/json', ...(key?.startsWith('pk_') ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify(body),
        }),
      )
      say(res.status)
    } finally {
      deadline.clear()
    }
  } catch (e) {
    say(e instanceof Error ? e.name : 'error')
  }
}

/** Called by ensureSignedIn(). app_opened now, active_session every 30 minutes; never fails the app, never blocks. */
export function startTelemetry(d: GateDevice): void {
  if (telemetryTimer) return
  const s = Number(d.value('PUBLIK_TELEMETRY_INTERVAL_SECONDS')) // tests only
  telemetryTimer = setInterval(() => void sendEvent(d, 'active_session'), (s >= 1 && s <= 86_400 ? s : TELEMETRY_INTERVAL_SECONDS) * 1000)
  void sendEvent(d, 'app_opened')
}

/** Sign out (the gate runs again) and tests. */
export function stopTelemetry(): void {
  if (telemetryTimer) clearInterval(telemetryTimer)
  telemetryTimer = null
}
