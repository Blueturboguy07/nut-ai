import { describe, expect, it, vi } from 'vitest'
import {
  chargeUsdFromHeaders,
  classifyGatewayError,
  formatMicros,
  isSafePublikLink,
  isUsableAppToken,
  provision,
  walletFromHeaders,
  walletFromJson,
  emptyWallet,
  type PublikBuildConfig,
} from './publik-core'

/**
 * The pure half of publik API against a scripted fetch: what the mint posts,
 * how each status maps to a named outcome, and how the gateway's headers and
 * error envelopes become the balance line and the six failure states.
 */

const TOKEN = `pat_nut-ai_${'a'.repeat(32)}`
const KEY = `pk_live_${'b'.repeat(12)}_${'c'.repeat(32)}`
const CFG: PublikBuildConfig = {
  appToken: TOKEN,
  appSlug: 'nut-ai',
  baseUrl: 'https://publikhq.com/api/v1',
  disclosureVersion: 1,
  models: { scan: 'publik-balanced', text: 'publik-fast' },
}
const INPUT = { cfg: CFG, installId: '11111111-2222-4333-8444-555555555555', appVersion: '0.2.0', os: 'ios' as const, osVersion: '18.6', deviceName: 'iPhone' }

type Call = { url: string; init: any }
function scripted(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

const MINT_201 = {
  install_id: INPUT.installId,
  key: KEY,
  base_url: 'https://publikhq.com/api/v1',
  models: { fast: 'publik-fast', balanced: 'publik-balanced', smart: 'publik-smart' },
  claim_code: 'HK7F-2QWD',
  claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
  claim_state: 'anonymous',
  starter_micros: 250_000,
  balance_micros: 250_000,
  starting_credit_micros: 250_000,
  wallet: {
    balance_micros: 250_000,
    claim_state: 'anonymous',
    starter: { remaining_micros: 250_000, expires_at: null },
    week: { used_micros: 0, budget_micros: null, resets_at: '2026-09-26T00:00:00Z' },
    claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
    add_credit_url: 'https://publikhq.com/dashboard/api/add',
  },
}

describe('provision', () => {
  it('posts the app token, install id, os and dialects, and returns key + install + wallet on 201', async () => {
    const { calls, impl } = scripted(201, MINT_201)
    const r = await provision(INPUT, impl)
    expect(calls[0]!.url).toBe('https://publikhq.com/api/v1/installs')
    const body = JSON.parse(calls[0]!.init.body)
    expect(body.app_token).toBe(TOKEN)
    expect(body.app_slug).toBe('nut-ai')
    expect(body.install_id).toBe(INPUT.installId)
    expect(body.os).toBe('ios')
    expect(body.disclosure_version).toBe(1)
    expect(body.dialects).toEqual(['chat_completions'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.key).toBe(KEY)
      expect(r.starterMicros).toBe(250_000)
      expect(r.install.claimUrl).toBe('https://publikhq.com/claim/HK7F-2QWD')
      expect(r.install.claimState).toBe('anonymous')
      expect(r.install.baseUrl).toBe('https://publikhq.com/api/v1')
      expect(r.install.models.fast).toBe('publik-fast')
      expect(r.wallet.balanceMicros).toBe(250_000)
      expect(r.wallet.starterRemainingMicros).toBe(250_000)
      expect(r.wallet.weekBudgetMicros).toBeNull()
      expect(r.wallet.addCreditUrl).toBe('https://publikhq.com/dashboard/api/add')
    }
  })

  it('honours base_url from the response over the compiled default, publikhq.com only', async () => {
    const good = await provision(INPUT, scripted(201, { ...MINT_201, base_url: 'https://publikhq.com/api/v2' }).impl)
    expect(good.ok && good.install.baseUrl).toBe('https://publikhq.com/api/v2')
    const bad = await provision(INPUT, scripted(201, { ...MINT_201, base_url: 'https://evil.example/api/v1' }).impl)
    expect(bad.ok && bad.install.baseUrl).toBe('https://publikhq.com/api/v1')
  })

  it('200 replay with key:null is a named outcome, not a key', async () => {
    const r = await provision(INPUT, scripted(200, { ...MINT_201, key: null, starter_micros: 0 }).impl)
    expect(r).toMatchObject({ ok: false, kind: 'replayed' })
  })

  it('maps 429 / 401 / 403 / 503 / thrown TypeError to named failures', async () => {
    expect(await provision(INPUT, scripted(429, {}, { 'retry-after': '120' }).impl)).toMatchObject({ ok: false, kind: 'rate-limited', retryAfterSec: 120 })
    expect(await provision(INPUT, scripted(401, {}).impl)).toMatchObject({ ok: false, kind: 'token-revoked' })
    expect(await provision(INPUT, scripted(403, {}).impl)).toMatchObject({ ok: false, kind: 'token-revoked' })
    expect(await provision(INPUT, scripted(503, {}).impl)).toMatchObject({ ok: false, kind: 'unavailable', status: 503 })
    const thrower = vi.fn(async () => { throw new TypeError('Network request failed') }) as unknown as typeof fetch
    expect(await provision(INPUT, thrower)).toMatchObject({ ok: false, kind: 'offline' })
  })

  it('drops a claim_url that is not on publikhq.com', async () => {
    const r = await provision(INPUT, scripted(201, { ...MINT_201, claim_url: 'https://publikhq.com.evil/claim/x', wallet: {} }).impl)
    expect(r.ok && r.install.claimUrl).toBeNull()
  })

  it('a malformed key shape is refused', async () => {
    const r = await provision(INPUT, scripted(201, { ...MINT_201, key: 'sk-not-a-publik-key' }).impl)
    expect(r).toMatchObject({ ok: false, kind: 'malformed' })
  })

  it('never calls fetch with the placeholder or an empty token', async () => {
    const { calls, impl } = scripted(201, MINT_201)
    expect(await provision({ ...INPUT, cfg: { ...CFG, appToken: 'pat_nut-ai_REPLACE_ME' } }, impl)).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(await provision({ ...INPUT, cfg: { ...CFG, appToken: '' } }, impl)).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(calls).toHaveLength(0)
  })
})

describe('app token shape', () => {
  it('accepts a minted token and rejects the placeholder', () => {
    expect(isUsableAppToken(TOKEN)).toBe(true)
    expect(isUsableAppToken('pat_nut-ai_REPLACE_ME')).toBe(false)
    expect(isUsableAppToken('')).toBe(false)
    expect(isUsableAppToken(undefined)).toBe(false)
  })
})

describe('wallet from headers', () => {
  it('reads x-publik-balance over the -micros alias and treats "none" as null', () => {
    const h = new Headers({
      'x-publik-request-id': 'r1',
      'x-publik-balance': '1240',
      'x-publik-balance-micros': '9999',
      'x-publik-week-used': '248760',
      'x-publik-week-budget': 'none',
      'x-publik-week-resets-at': '2026-09-25T17:04:11Z',
      'x-publik-claim-state': 'claimed',
    })
    const w = walletFromHeaders(h, emptyWallet())
    expect(w.balanceMicros).toBe(1240)
    expect(w.weekUsedMicros).toBe(248760)
    expect(w.weekBudgetMicros).toBeNull()
    expect(w.weekResetsAt).toBe('2026-09-25T17:04:11Z')
    expect(w.claimState).toBe('claimed')
    // Absent starter header on a metered response means the starter is spent.
    expect(w.starterRemainingMicros).toBeNull()
  })

  it('missing headers keep the previous snapshot', () => {
    const prev = { ...emptyWallet('anonymous'), balanceMicros: 5, weekUsedMicros: 6, weekBudgetMicros: 7, weekResetsAt: 'x', starterRemainingMicros: 8 }
    const w = walletFromHeaders(new Headers({}), prev)
    expect(w).toEqual(prev)
  })

  it('chargeUsdFromHeaders and formatMicros', () => {
    expect(chargeUsdFromHeaders(new Headers({ 'x-publik-charge-micros': '41000' }))).toBe(0.041)
    expect(chargeUsdFromHeaders(new Headers({}))).toBeNull()
    expect(formatMicros(1_920_000)).toBe('$1.92')
    expect(formatMicros(400)).toBe('$0.0004')
    expect(formatMicros(0)).toBe('$0.00')
    expect(formatMicros(null)).toBe('—')
  })

  it('walletFromJson reads the GET /wallet shape', () => {
    const w = walletFromJson(MINT_201.wallet, 'anonymous')
    expect(w.balanceMicros).toBe(250_000)
    expect(w.weekResetsAt).toBe('2026-09-26T00:00:00Z')
    expect(w.claimUrl).toBe('https://publikhq.com/claim/HK7F-2QWD')
  })
})

describe('isSafePublikLink', () => {
  it('is true only for the exact origin', () => {
    expect(isSafePublikLink('https://publikhq.com/claim/AB')).toBe(true)
    expect(isSafePublikLink('https://publikhq.com.evil/claim/AB')).toBe(false)
    expect(isSafePublikLink('http://publikhq.com/claim/AB')).toBe(false)
    expect(isSafePublikLink('https://www.publikhq.com/x')).toBe(false)
    expect(isSafePublikLink(null)).toBe(false)
    expect(isSafePublikLink('not a url')).toBe(false)
  })
})

describe('classifyGatewayError', () => {
  const body402 = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      error: {
        type: 'insufficient_credit',
        message: 'Not enough publik credit for this request. Link this phone and pick a plan at the link below, or use your own key.',
        available_micros: 1240,
        required_micros: 41000,
        claim_state: 'anonymous',
        top_up_url: 'https://publikhq.com/claim/HK7F-2QWD',
        claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
        add_credit_url: 'https://publikhq.com/dashboard/api/add',
        ...over,
      },
    })

  it('402 insufficient_credit → quota-exhausted with the server message and exactly one link (top_up_url)', () => {
    const f = classifyGatewayError(402, body402())
    expect(f?.kind).toBe('quota-exhausted')
    expect(f?.retryable).toBe(false)
    expect(f?.message).toMatch(/^Not enough publik credit/)
    expect(f?.action).toEqual({ label: 'Link this phone & pick a plan', url: 'https://publikhq.com/claim/HK7F-2QWD' })
  })

  it('claimed → the button becomes "Add a plan or pack" and follows top_up_url', () => {
    const f = classifyGatewayError(402, body402({ claim_state: 'claimed', top_up_url: 'https://publikhq.com/dashboard/api/add' }))
    expect(f?.action).toEqual({ label: 'Add a plan or pack', url: 'https://publikhq.com/dashboard/api/add' })
  })

  it('a top_up_url off publikhq.com yields no action at all', () => {
    const f = classifyGatewayError(402, body402({ top_up_url: 'https://evil.example/x', claim_url: 'https://evil.example/y', add_credit_url: 'https://evil.example/z' }))
    expect(f?.kind).toBe('quota-exhausted')
    expect(f?.action).toBeUndefined()
  })

  it('key_revoked carries the reprovision flag; invalid_api_key does not', () => {
    const revoked = classifyGatewayError(401, JSON.stringify({ error: { type: 'key_revoked', message: 'x', reprovision: true } }))
    expect(revoked).toMatchObject({ kind: 'key-invalid', reprovision: true })
    const invalid = classifyGatewayError(401, JSON.stringify({ error: { type: 'invalid_api_key', message: 'x' } }))
    expect(invalid?.kind).toBe('key-invalid')
    expect(invalid?.reprovision).toBeUndefined()
  })

  it('caps, model gates and outages map to their own states', () => {
    expect(classifyGatewayError(429, JSON.stringify({ error: { type: 'daily_cap_reached', claim_state: 'claimed', top_up_url: 'https://publikhq.com/dashboard/api/add' } }))).toMatchObject({ kind: 'quota-exhausted', retryable: false, action: { label: 'Raise the cap' } })
    expect(classifyGatewayError(429, JSON.stringify({ error: { type: 'rate_limit_exceeded' } }))).toMatchObject({ kind: 'error-retryable', retryable: true })
    expect(classifyGatewayError(402, JSON.stringify({ error: { type: 'model_requires_claim', claim_url: 'https://publikhq.com/claim/A' } }))).toMatchObject({ kind: 'model-unavailable', action: { url: 'https://publikhq.com/claim/A' } })
    expect(classifyGatewayError(400, JSON.stringify({ error: { type: 'unknown_model', message: 'Unknown model' } }))).toMatchObject({ kind: 'model-unavailable' })
    expect(classifyGatewayError(503, JSON.stringify({ error: { type: 'gateway_unavailable' } }))).toMatchObject({ kind: 'error-retryable', retryable: true })
  })

  it('a non-publik body is not claimed', () => {
    expect(classifyGatewayError(402, 'Payment Required')).toBeNull()
    expect(classifyGatewayError(400, JSON.stringify({ error: { message: 'bad', type: 'invalid_request_error' } }))).toBeNull()
    expect(classifyGatewayError(400, JSON.stringify({ error: 'string' }))).toBeNull()
  })
})
