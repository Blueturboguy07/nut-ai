import { describe, expect, it, vi } from 'vitest'
import {
  APP_TOKEN_PLACEHOLDER,
  appTokenOf,
  chargeUsdFromHeaders,
  classifyGatewayError,
  purchaseLinksFor,
  purchaseLinksOn,
  setPurchaseLinks,
  gateWalletFromJson,
  notePlanResetsAt,
  planUse,
  inAppClaimUrl,
  isSafePublikLink,
  isUsableAppToken,
  provision,
  provisionGateMessage,
  walletFromHeaders,
  walletPatchFromHeaders,
  walletFromJson,
  emptyWallet,
  publikScanModel,
  type PublikBuildConfig,
} from './publik-core'
import { planLimitMessage, planUseLine, PRIVACY_URL, PUBLIK_DELETE_ACCOUNT_URL, provisionFailureMessage, resetPhrase, waitPhrase } from './publik-copy'

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
  models: { scan: 'publik-fast', text: 'publik-fast' },
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

// publik migration 0059: an anonymous install is minted at $0.00. The one
// free thing is $0.05 of use, once per account, when the phone is linked.
const MINT_201 = {
  install_id: INPUT.installId,
  key: KEY,
  base_url: 'https://publikhq.com/api/v1',
  models: { fast: 'publik-fast', balanced: 'publik-balanced', smart: 'publik-smart' },
  claim_code: 'HK7F-2QWD',
  claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
  claim_state: 'anonymous',
  starter_micros: 0,
  balance_micros: 0,
  starting_credit_micros: 0,
  wallet: {
    balance_micros: 0,
    claim_state: 'anonymous',
    starter: { remaining_micros: 0, expires_at: null },
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
      expect(r.starterMicros).toBe(0)
      expect(r.install.claimUrl).toBe('https://publikhq.com/claim/HK7F-2QWD?in_app=1')
      expect(r.install.claimState).toBe('anonymous')
      expect(r.install.baseUrl).toBe('https://publikhq.com/api/v1')
      expect(r.install.models.fast).toBe('publik-fast')
      expect(r.wallet.balanceMicros).toBe(0)
      expect(r.wallet.starterRemainingMicros).toBe(0)
      expect(r.wallet.weekBudgetMicros).toBeNull()
      expect(r.wallet.addCreditUrl).toBe('https://publikhq.com/dashboard/api/add')
    }
  })

  it('a mint bound to a signed-in account reads the linked balance ($0.05 link starter) from the wallet', async () => {
    const bound = {
      ...MINT_201,
      claim_state: 'claimed',
      claim_code: null,
      claim_url: null,
      starter_micros: 0,
      starting_credit_micros: 0,
      balance_micros: 50_000,
      wallet: { ...MINT_201.wallet, claim_state: 'claimed', balance_micros: 50_000, claim_url: null },
    }
    const r = await provision(INPUT, scripted(201, bound).impl)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.starterMicros).toBe(0)
      expect(r.install.claimState).toBe('claimed')
      expect(r.wallet.claimState).toBe('claimed')
      expect(r.wallet.balanceMicros).toBe(50_000)
    }
  })

  it('honours base_url from the response over the compiled default, publikhq.com only', async () => {
    const good = await provision(INPUT, scripted(201, { ...MINT_201, base_url: 'https://publikhq.com/api/v2' }).impl)
    expect(good.ok && good.install.baseUrl).toBe('https://publikhq.com/api/v2')
    const bad = await provision(INPUT, scripted(201, { ...MINT_201, base_url: 'https://evil.example/api/v1' }).impl)
    expect(bad.ok && bad.install.baseUrl).toBe('https://publikhq.com/api/v1')
  })

  it('403 install_revoked is its own outcome (the caller makes ONE new install), not a revoked app token', async () => {
    const r = await provision(INPUT, scripted(403, { error: { type: 'install_revoked', message: 'This install was disconnected by its owner. Provision a new install.', reprovision: false } }).impl)
    expect(r).toEqual({ ok: false, kind: 'install-revoked', status: 403 })
    expect(r.ok === false && provisionGateMessage(r, CFG)).toContain('Retry')
  })

  it('a 401 / 403 page that is not publik\'s JSON (a captive portal, a proxy) is "not reachable", not a revoked token', async () => {
    for (const status of [401, 403]) {
      const portal = vi.fn(async () => ({
        ok: false,
        status,
        headers: new Headers(),
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0')
        },
      })) as unknown as typeof fetch
      const r = await provision(INPUT, portal)
      expect(r).toEqual({ ok: false, kind: 'offline', status })
      expect(r.ok === false && provisionGateMessage(r, CFG)).toBeUndefined()
    }
  })

  it('a 200 that is not JSON (a captive portal) is "not reachable", never "Update Nut AI"', async () => {
    for (const body of ['<html>', null, ['not', 'an', 'object']]) {
      const page = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => {
          if (body === '<html>') throw new SyntaxError('Unexpected token < in JSON at position 0')
          return body
        },
      })) as unknown as typeof fetch
      const r = await provision(INPUT, page)
      expect(r).toEqual({ ok: false, kind: 'offline', status: 200 })
      // The gate shows the Retry screen's "not reachable" line (undefined = UNREACHABLE_MESSAGE).
      expect(r.ok === false && provisionGateMessage(r, CFG)).toBeUndefined()
      expect(r.ok === false && provisionFailureMessage(r)).toMatch(/^No connection/)
    }
  })

  it('200 replay with key:null is a named outcome, not a key', async () => {
    const r = await provision(INPUT, scripted(200, { ...MINT_201, key: null, starter_micros: 0 }).impl)
    expect(r).toMatchObject({ ok: false, kind: 'replayed' })
  })

  it('maps 429 / 401 / 403 / 503 / thrown TypeError to named failures', async () => {
    expect(await provision(INPUT, scripted(429, {}, { 'retry-after': '120' }).impl)).toMatchObject({ ok: false, kind: 'rate-limited', retryAfterSec: 120 })
    expect(await provision(INPUT, scripted(401, {}).impl)).toMatchObject({ ok: false, kind: 'token-revoked' })
    expect(await provision(INPUT, scripted(403, {}).impl)).toMatchObject({ ok: false, kind: 'token-revoked' })
    // The server's reasons (app/api/v1/installs): 401 invalid_app_token, 403 app_suspended, 403 install_revoked.
    expect(await provision(INPUT, scripted(401, { error: { type: 'invalid_app_token', message: 'x' } }).impl)).toMatchObject({ ok: false, kind: 'token-revoked', status: 401 })
    expect(await provision(INPUT, scripted(403, { error: { type: 'app_suspended', message: 'x' } }).impl)).toMatchObject({ ok: false, kind: 'token-revoked', status: 403 })
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

describe('the app token of a build', () => {
  const FILE = `pat_nut-ai_${'f'.repeat(32)}`
  it('a release build takes it ONLY from the build input (PUBLIK_APP_TOKEN)', () => {
    expect(appTokenOf(TOKEN, FILE, false)).toBe(TOKEN)
    expect(appTokenOf(undefined, FILE, false)).toBe(APP_TOKEN_PLACEHOLDER)
    expect(appTokenOf(null, FILE, false)).toBe(APP_TOKEN_PLACEHOLDER)
    expect(appTokenOf('', FILE, false)).toBe(APP_TOKEN_PLACEHOLDER)
    expect(appTokenOf(APP_TOKEN_PLACEHOLDER, FILE, false)).toBe(APP_TOKEN_PLACEHOLDER)
  })
  it('the committed file serves a dev build only, and the build input still wins there', () => {
    expect(appTokenOf(undefined, FILE, true)).toBe(FILE)
    expect(appTokenOf(TOKEN, FILE, true)).toBe(TOKEN)
    expect(appTokenOf(undefined, APP_TOKEN_PLACEHOLDER, true)).toBe(APP_TOKEN_PLACEHOLDER)
  })
})

describe('purchase links (the App Store rule)', () => {
  it('an App Store build shows them only in the US storefront; unknown = hidden', () => {
    expect(purchaseLinksFor(true, 'USA')).toBe(true)
    expect(purchaseLinksFor(true, 'usa')).toBe(true)
    expect(purchaseLinksFor(true, 'US')).toBe(true)
    for (const c of ['GBR', 'CAN', 'DEU', 'IND', 'JPN', '', null, undefined]) expect(purchaseLinksFor(true, c)).toBe(false)
  })
  it('a build that is not an App Store build shows them everywhere', () => {
    for (const c of ['USA', 'GBR', null]) expect(purchaseLinksFor(false, c)).toBe(true)
  })
  it('the module setting is what classifyGatewayError and gateScreen use by default', () => {
    const before = purchaseLinksOn()
    try {
      setPurchaseLinks(false)
      expect(purchaseLinksOn()).toBe(false)
      const f = classifyGatewayError(402, JSON.stringify({ error: { type: 'insufficient_credit', claim_state: 'claimed', top_up_url: 'https://publikhq.com/wallet' } }))
      expect(f?.action).toBeUndefined()
    } finally {
      setPurchaseLinks(before)
    }
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

  it('patches only what the headers named, so silence and "none" differ', () => {
    // Silence: nothing but the request id. Every field is left to the store.
    expect(walletPatchFromHeaders(new Headers({ 'x-publik-request-id': 'r1' }))).toEqual({
      // ...except the starter, whose absence on a metered response IS the news.
      starterRemainingMicros: null,
    })

    // "none": the gateway says there is no week budget any more.
    const lapsed = walletPatchFromHeaders(
      new Headers({ 'x-publik-request-id': 'r2', 'x-publik-week-budget': 'none', 'x-publik-starter-remaining': '10' }),
    )
    expect('weekBudgetMicros' in lapsed).toBe(true)
    expect(lapsed.weekBudgetMicros).toBeNull()
    expect(lapsed.starterRemainingMicros).toBe(10)
    expect('balanceMicros' in lapsed).toBe(false)
    expect('claimState' in lapsed).toBe(false)

    // A non-publik response names nothing at all — not even the starter.
    expect(walletPatchFromHeaders(new Headers({}))).toEqual({})
  })

  it('a lapsed plan clears the stored budget; a silent response keeps it', () => {
    const stored = { ...emptyWallet('claimed'), balanceMicros: 3_120_000, weekBudgetMicros: 4_600_000, weekUsedMicros: 1_200_000 }

    // Silence about the week keeps the budget on the card.
    const quiet = { ...stored, ...walletPatchFromHeaders(new Headers({ 'x-publik-request-id': 'r1', 'x-publik-balance': '3000000' })) }
    expect(quiet.weekBudgetMicros).toBe(4_600_000)
    expect(quiet.balanceMicros).toBe(3_000_000)

    // "none" takes it off.
    const lapsed = { ...stored, ...walletPatchFromHeaders(new Headers({ 'x-publik-request-id': 'r2', 'x-publik-week-budget': 'none' })) }
    expect(lapsed.weekBudgetMicros).toBeNull()
    expect(lapsed.balanceMicros).toBe(3_120_000)
  })

  it('chargeUsdFromHeaders (kept for the local scan log; never shown)', () => {
    expect(chargeUsdFromHeaders(new Headers({ 'x-publik-charge-micros': '41000' }))).toBe(0.041)
    expect(chargeUsdFromHeaders(new Headers({}))).toBeNull()
  })

  it('walletFromJson reads the GET /wallet shape', () => {
    const w = walletFromJson(MINT_201.wallet, 'anonymous')
    expect(w.balanceMicros).toBe(0)
    expect(w.weekResetsAt).toBe('2026-09-26T00:00:00Z')
    expect(w.claimUrl).toBe('https://publikhq.com/claim/HK7F-2QWD?in_app=1')
  })
})

describe('the publik pages the app opens', () => {
  it('inAppClaimUrl adds in_app=1 and keeps the other query values and the fragment', () => {
    expect(inAppClaimUrl('https://publikhq.com/claim/HK7F-2QWD')).toBe('https://publikhq.com/claim/HK7F-2QWD?in_app=1')
    expect(inAppClaimUrl('https://publikhq.com/claim/A?ref=app&x=1')).toBe('https://publikhq.com/claim/A?ref=app&x=1&in_app=1')
    expect(inAppClaimUrl('https://publikhq.com/claim/A?')).toBe('https://publikhq.com/claim/A?in_app=1')
    expect(inAppClaimUrl('https://publikhq.com/claim/A#top')).toBe('https://publikhq.com/claim/A?in_app=1#top')
    expect(inAppClaimUrl('https://publikhq.com/claim/A?ref=app#top')).toBe('https://publikhq.com/claim/A?ref=app&in_app=1#top')
    // An old in_app value is replaced, not doubled.
    expect(inAppClaimUrl('https://publikhq.com/claim/A?in_app=0&ref=app')).toBe('https://publikhq.com/claim/A?ref=app&in_app=1')
    // Given its own result, the same link.
    const once = inAppClaimUrl('https://publikhq.com/claim/A?ref=app')
    expect(inAppClaimUrl(once)).toBe(once)
  })

  it('every claim_url from publik becomes the in-app claim link; a link off publik stays null', () => {
    const gate = gateWalletFromJson({ claim_state: 'anonymous', claim_url: 'https://publikhq.com/claim/A?ref=app', top_up_url: 'https://publikhq.com/wallet?top_up=1' })
    expect(gate.claimUrl).toBe('https://publikhq.com/claim/A?ref=app&in_app=1')
    // Get a plan (US storefront only): the site, as before.
    expect(gate.topUpUrl).toBe('https://publikhq.com/wallet?top_up=1')
    expect(gateWalletFromJson({ claim_state: 'anonymous', claim_url: 'https://evil.example/claim/A' }).claimUrl).toBeNull()
    expect(walletFromJson({ claim_url: 'https://publikhq.com.evil/claim/A' }, 'anonymous').claimUrl).toBeNull()
  })

  it('privacy and account deletion open publik\'s bare in-app pages', () => {
    expect(PRIVACY_URL).toBe('https://publikhq.com/in-app/privacy')
    expect(PUBLIK_DELETE_ACCOUNT_URL).toBe('https://publikhq.com/in-app/delete-account')
    expect(isSafePublikLink(PRIVACY_URL)).toBe(true)
    expect(isSafePublikLink(PUBLIK_DELETE_ACCOUNT_URL)).toBe(true)
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
        message: 'Your publik balance is too low for this request. Link this computer to your publik account at the link below for $0.05 of free use, pick a plan there, or use your own key.',
        available_micros: 0,
        required_micros: 41000,
        claim_state: 'anonymous',
        top_up_url: 'https://publikhq.com/claim/HK7F-2QWD',
        claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
        add_credit_url: 'https://publikhq.com/dashboard/api/add',
        ...over,
      },
    })

  it('402 insufficient_credit → quota-exhausted in our own words (never the gateway amount) and exactly one link (top_up_url)', () => {
    const f = classifyGatewayError(402, body402())
    expect(f?.kind).toBe('quota-exhausted')
    expect(f?.retryable).toBe(false)
    expect(f?.message).toBe('Your publik plan limit is reached. Get a plan at the link below, or use your own key in Profile → AI provider.')
    expect(f?.message).not.toMatch(/\$\d/)
    expect(f?.action).toEqual({ label: 'Link this phone & pick a plan', url: 'https://publikhq.com/claim/HK7F-2QWD' })
  })

  it('claimed → the button is "Get a plan" and follows top_up_url', () => {
    const f = classifyGatewayError(402, body402({ claim_state: 'claimed', top_up_url: 'https://publikhq.com/dashboard/api/add' }))
    expect(f?.action).toEqual({ label: 'Get a plan', url: 'https://publikhq.com/dashboard/api/add' })
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
    expect(classifyGatewayError(429, JSON.stringify({ error: { type: 'daily_cap_reached', claim_state: 'claimed', top_up_url: 'https://publikhq.com/dashboard/api/add' } }))).toMatchObject({ kind: 'quota-exhausted', retryable: false, action: { label: 'Get a plan' } })
    expect(classifyGatewayError(429, JSON.stringify({ error: { type: 'rate_limit_exceeded' } }))).toMatchObject({ kind: 'error-retryable', retryable: true })
    expect(classifyGatewayError(402, JSON.stringify({ error: { type: 'model_requires_claim', claim_url: 'https://publikhq.com/claim/A' } }))).toMatchObject({ kind: 'model-unavailable', action: { url: 'https://publikhq.com/claim/A?in_app=1' } })
    expect(classifyGatewayError(400, JSON.stringify({ error: { type: 'unknown_model', message: 'Unknown model' } }))).toMatchObject({ kind: 'model-unavailable' })
    expect(classifyGatewayError(503, JSON.stringify({ error: { type: 'gateway_unavailable' } }))).toMatchObject({ kind: 'error-retryable', retryable: true })
  })

  it('outside the US storefront of an App Store build: no link and no price, in every link case', () => {
    const anon402 = classifyGatewayError(402, body402(), false)
    expect(anon402).toMatchObject({ kind: 'quota-exhausted', retryable: false })
    expect(anon402?.action).toBeUndefined()
    // Not the gateway's own message, which names a link and an amount.
    expect(anon402?.message).toBe('Your publik plan limit is reached. To get a plan, search for "publik" on Google. Or use your own key in Profile → AI provider.')
    expect(anon402?.message).not.toMatch(/\$|pack|link|https?:/i)
    const claimed402 = classifyGatewayError(402, body402({ claim_state: 'claimed', message: undefined }), false)
    expect(claimed402?.action).toBeUndefined()
    expect(claimed402?.message).not.toMatch(/\$|pack|https?:/i)
    for (const type of ['daily_cap_reached', 'week_budget_reached', 'model_requires_claim']) {
      const f = classifyGatewayError(402, JSON.stringify({ error: { type, claim_state: 'claimed', top_up_url: 'https://publikhq.com/wallet', claim_url: 'https://publikhq.com/claim/A' } }), false)
      expect(f).not.toBeNull()
      expect(f?.action).toBeUndefined()
      expect(f?.message).not.toMatch(/\$/)
    }
    // In the US storefront (or not an App Store build) the link is there as before.
    expect(classifyGatewayError(402, body402(), true)?.action).toEqual({ label: 'Link this phone & pick a plan', url: 'https://publikhq.com/claim/HK7F-2QWD' })
  })

  it('a non-publik body is not claimed', () => {
    expect(classifyGatewayError(402, 'Payment Required')).toBeNull()
    expect(classifyGatewayError(400, JSON.stringify({ error: { message: 'bad', type: 'invalid_request_error' } }))).toBeNull()
    expect(classifyGatewayError(400, JSON.stringify({ error: 'string' }))).toBeNull()
  })
})

describe('publikScanModel', () => {
  it('no pick and no old value → the build default', () => {
    expect(publikScanModel(CFG, '', '')).toBe('publik-fast')
  })

  it('the old auto-written publik-balanced is not a pick (phones connected up to 71ee482)', () => {
    expect(publikScanModel(CFG, '', 'publik-balanced')).toBe('publik-fast')
  })

  it('a Profile pick wins over everything', () => {
    expect(publikScanModel(CFG, 'publik-balanced', '')).toBe('publik-balanced')
    expect(publikScanModel(CFG, 'publik-smart', 'publik-balanced')).toBe('publik-smart')
  })

  it('another publik tier in the old slot was a Profile tap and is kept', () => {
    expect(publikScanModel(CFG, '', 'publik-smart')).toBe('publik-smart')
  })

  it('a value that is not a publik tier is ignored in both slots', () => {
    expect(publikScanModel(CFG, 'gpt-4o-mini', 'claude-haiku')).toBe('publik-fast')
  })
})

describe('provisionFailureMessage', () => {
  it('a 429 names the real wait from Retry-After, not "a minute" (2216 s seen Nov 1 2026)', () => {
    const m = provisionFailureMessage({ ok: false, kind: 'rate-limited', status: 429, retryAfterSec: 2216 })
    expect(m).toContain('about 37 minutes')
    expect(m).toContain('this network')
    expect(m).toContain('use your own key')
  })

  it('waitPhrase rounds up and never says less than a minute', () => {
    expect(waitPhrase(undefined)).toBe('about a minute')
    expect(waitPhrase(0)).toBe('about a minute')
    expect(waitPhrase(30)).toBe('about a minute')
    expect(waitPhrase(61)).toBe('about 2 minutes')
    expect(waitPhrase(3600)).toBe('about 60 minutes')
  })

  it('every other kind keeps its own sentence', () => {
    expect(provisionFailureMessage({ ok: false, kind: 'offline' })).toMatch(/^No connection\. Nothing was set up/)
    expect(provisionFailureMessage({ ok: false, kind: 'unavailable' })).toContain('not available for this build')
    expect(provisionFailureMessage({ ok: false, kind: 'token-revoked', status: 401 })).toContain('not available for this build')
    expect(provisionFailureMessage({ ok: false, kind: 'malformed' })).toContain('Update publik Nut AI')
  })
})

describe('no money: AI use is a percent of the plan limit (founder rule, Nov 14 2026)', () => {
  // Saturday Nov 14 2026, noon, local time.
  const now = new Date(2026, 10, 14, 12, 0, 0)
  const monday = new Date(2026, 10, 16, 0, 0, 0).toISOString()
  const base = { ...emptyWallet('claimed') }

  it('planUse reads used_percent, else 100 - remaining_percent, else the week figures', () => {
    expect(planUse(walletFromJson({ used_percent: 62.7, resets_at: monday }, 'claimed'))).toEqual({ usedPercent: 62, resetsAt: monday, limitReached: false })
    expect(planUse(walletFromJson({ remaining_percent: 25 }, 'claimed'))).toMatchObject({ usedPercent: 75, limitReached: false })
    expect(planUse({ ...base, weekUsedMicros: 300, weekBudgetMicros: 1200, weekResetsAt: monday })).toEqual({ usedPercent: 25, resetsAt: monday, limitReached: false })
    expect(planUse({ ...base, weekUsedMicros: 1500, weekBudgetMicros: 1200 })).toMatchObject({ usedPercent: 100, limitReached: true })
    expect(planUse(walletFromJson({ used_percent: 100 }, 'claimed')).limitReached).toBe(true)
    // 99.6% is not the limit.
    expect(planUse({ ...base, weekUsedMicros: 996, weekBudgetMicros: 1000 })).toMatchObject({ usedPercent: 99, limitReached: false })
  })

  it('with no limit to measure against: no number, only "Plan active" or "Plan limit reached"', () => {
    expect(planUse({ ...base, balanceMicros: 40_000 })).toEqual({ usedPercent: null, resetsAt: null, limitReached: false })
    expect(planUse({ ...base, balanceMicros: 0 })).toEqual({ usedPercent: null, resetsAt: null, limitReached: true })
    expect(planUseLine(planUse({ ...base, balanceMicros: 40_000 }), now)).toBe('Plan active')
    expect(planUseLine(planUse({ ...base, balanceMicros: 0 }), now)).toBe('Plan limit reached')
    expect(planUseLine({ usedPercent: null, resetsAt: monday, limitReached: true }, now)).toBe('Plan limit reached · resets Monday')
  })

  it('planUseLine: "62% of your plan used · resets Monday"', () => {
    expect(planUseLine({ usedPercent: 62, resetsAt: monday, limitReached: false }, now)).toBe('62% of your plan used · resets Monday')
    expect(planUseLine({ usedPercent: 0, resetsAt: null, limitReached: false }, now)).toBe('0% of your plan used')
  })

  it('resetPhrase: a weekday within 6 days, "today", a date after that; nothing for the past or junk', () => {
    expect(resetPhrase(monday, now)).toBe('resets Monday')
    expect(resetPhrase(new Date(2026, 10, 14, 23, 0, 0).toISOString(), now)).toBe('resets today')
    expect(resetPhrase(new Date(2026, 10, 24, 9, 0, 0).toISOString(), now)).toBe('resets Nov 24')
    expect(resetPhrase(new Date(2026, 10, 13).toISOString(), now)).toBeNull()
    expect(resetPhrase('not a date', now)).toBeNull()
    expect(resetPhrase(null, now)).toBeNull()
  })

  it('the plan-limit message names the reset and keeps the storefront rule', () => {
    expect(planLimitMessage(monday, true, now)).toBe('Your publik plan limit is reached. It resets Monday. Get a plan at the link below, or use your own key in Profile → AI provider.')
    expect(planLimitMessage(monday, false, now)).toBe(
      'Your publik plan limit is reached. It resets Monday. To get a plan, search for "publik" on Google. Or use your own key in Profile → AI provider.',
    )
    expect(planLimitMessage(null, false, now)).toBe('Your publik plan limit is reached. To get a plan, search for "publik" on Google. Or use your own key in Profile → AI provider.')
  })

  it('a 402 or a weekly limit says when it resets: from the error, else the last wallet', () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const phrase = resetPhrase(soon)!
    const week = classifyGatewayError(402, JSON.stringify({ error: { type: 'week_budget_reached', claim_state: 'claimed', resets_at: soon } }), false)
    expect(week?.kind).toBe('quota-exhausted')
    expect(week?.message).toContain(`It ${phrase}.`)
    try {
      notePlanResetsAt(soon)
      const f = classifyGatewayError(402, JSON.stringify({ error: { type: 'insufficient_credit', claim_state: 'claimed', message: 'Add $5.00 to keep going.' } }), true)
      expect(f?.message).toContain(`It ${phrase}.`)
      expect(f?.message).not.toMatch(/\$\d/)
    } finally {
      notePlanResetsAt(null)
    }
  })

  it('a gateway message with an amount of money is never shown', () => {
    const f = classifyGatewayError(400, JSON.stringify({ error: { type: 'unknown_model', message: 'That model costs $0.07 a call.' } }))
    expect(f?.message).toBe('publik API does not know that model. Pick one in Profile → AI provider.')
  })
})
