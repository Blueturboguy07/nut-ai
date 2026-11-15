import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APP_SLUG,
  APP_VERSION,
  ensureSignedIn,
  gateAtStart,
  gateScreen,
  pauseTelemetry,
  provision,
  resumeTelemetry,
  stopTelemetry,
  USES_AI,
  type Choice,
  type GateAction,
  type GateDevice,
  type GateScreen,
  type GateUI,
  type GateWallet,
  type PublikBuildConfig,
} from './publik-core'

/**
 * Sign in with publik, the publik module's gate, against a fake publik that
 * answers /installs, /wallet and /telemetry, with a scripted UI that presses
 * the buttons (the same cases as publikhq.com's tests/publik-module-gate).
 */

const MOBILE = join(__dirname, '..', '..')
// Built, not literal: the publik scan looks for the endpoint paths, and the
// file it should name is the module (publik-core.ts), not this test.
const V1 = '/api/v1'

/** The exact words of the gate (the publik contract of 2026-11-10). */
const WORDS = {
  title: 'Sign in with publik',
  signInBody: 'This app uses your publik account. Click Sign in with publik, then sign in in your browser. This window continues when you are signed in.',
  signInButton: 'Sign in with publik',
  waiting: 'Waiting for you to sign in in your browser.',
  unreachable: 'publik is not reachable. Check your connection.',
  retry: 'Retry',
  chooseTitle: 'Choose how to pay for AI',
  chooseBody: 'This app uses AI. Get a publik plan, or use your own key.',
  getPlan: 'Get a plan',
  ownKey: 'Use my own key',
  connectTitle: 'Connect your plan',
  connectBody: 'Connect it to use AI in this app, or use your own key.',
  connect: 'Connect your plan',
} as const

const KEY = 'pk_live_gatetest'
const CFG: PublikBuildConfig = {
  appToken: `pat_nut-ai_${'a'.repeat(32)}`,
  appSlug: 'nut-ai',
  baseUrl: 'https://publikhq.com/api/v1',
  disclosureVersion: 1,
  models: { scan: 'publik-fast', text: 'publik-fast' },
}

type WalletBody = { claim_state: 'anonymous' | 'claimed'; account: { handle: string } | null; plan: { kind: string; label: string | null }; balance_micros: number }
const anonymous: WalletBody = { claim_state: 'anonymous', account: null, plan: { kind: 'none', label: null }, balance_micros: 0 }
const claimedEmpty: WalletBody = { claim_state: 'claimed', account: { handle: 'mann' }, plan: { kind: 'none', label: null }, balance_micros: 0 }
const claimedPlan: WalletBody = { claim_state: 'claimed', account: { handle: 'mann' }, plan: { kind: 'plan', label: 'Plus' }, balance_micros: 0 }

interface Req {
  path: string
  auth: string | null
  body: string
}

let wallets: WalletBody[]
let walletStatus: number
let installsStatus: number
let offline: boolean
let requests: Req[]
/** When set, GET /wallet answers this instead (a captive portal, a proxy, a rate limit). */
let walletRaw: (() => Response) | null
/** The claim_url of /installs and /wallet; null: publik sends none. */
let claimUrl: string | null

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body } as unknown as Response
}

const fakeFetch = (async (url: unknown, init?: RequestInit) => {
  if (offline) throw new TypeError('Network request failed')
  const path = new URL(String(url)).pathname
  const headers = (init?.headers ?? {}) as Record<string, string>
  requests.push({ path, auth: headers.authorization ?? null, body: typeof init?.body === 'string' ? init.body : '' })
  if (path === `${V1}/installs`) {
    if (installsStatus !== 201) return reply(installsStatus, { error: { type: 'invalid_app_token', message: 'This app token is not valid.' } })
    return reply(201, { key: KEY, install_id: JSON.parse(String(init?.body)).install_id, claim_url: claimUrl ?? undefined, claim_state: 'anonymous' })
  }
  if (path === `${V1}/wallet`) {
    if (walletRaw) return walletRaw()
    if (walletStatus !== 200) return reply(walletStatus, { error: { type: 'invalid_key', message: 'This key is not valid.' } })
    const w = wallets.length > 1 ? wallets.shift()! : wallets[0]!
    return reply(200, { ...w, claim_url: claimUrl ?? undefined, top_up_url: 'https://publikhq.com/wallet?top_up=1', linked_at: null })
  }
  if (path === `${V1}/telemetry`) return reply(204, null)
  return reply(404, {})
}) as unknown as typeof fetch

interface Phone {
  device: GateDevice
  stored: { key: string | null; claimUrl: string | null; choice: Choice | null; claimed?: boolean }
  /** The age check of the plan screen (false: a minor or an unknown age). */
  adult: boolean
  /** Profile → publik account → Count app use. */
  counting: boolean
  provisions: number
  forgot: number
  printed: string[]
  logs: string[]
}

function phone(values: Record<string, string> = {}, prior?: Phone['stored']): Phone {
  const p: Phone = {
    stored: prior ?? { key: null, claimUrl: null, choice: null },
    adult: true,
    counting: true,
    provisions: 0,
    forgot: 0,
    printed: [],
    logs: [],
    device: undefined as unknown as GateDevice,
  }
  p.device = {
    cfg: CFG,
    os: 'ios',
    fetch: fakeFetch,
    load: async () =>
      p.stored.key ? { key: p.stored.key, claimUrl: p.stored.claimUrl, choice: p.stored.choice, claimed: p.stored.claimed === true } : null,
    provision: async () => {
      p.provisions += 1
      const r = await provision(
        { cfg: CFG, installId: '11111111-2222-4333-8444-555555555555', appVersion: APP_VERSION, os: 'ios', osVersion: '18.6', deviceName: 'iPhone' },
        fakeFetch,
      )
      if (r.ok) p.stored = { key: r.key, claimUrl: r.install.claimUrl, choice: p.stored.choice, claimed: false }
      return r
    },
    forget: async () => {
      p.forgot += 1
      p.stored = { key: null, claimUrl: null, choice: null }
    },
    saveChoice: async (choice) => {
      p.stored = { ...p.stored, choice }
    },
    noteWallet: async (w) => {
      p.stored = { ...p.stored, claimed: w.claimState === 'claimed' }
    },
    planAllowed: async () => p.adult,
    countUse: async () => p.counting,
    // Polls at once in a test (3 s on a phone); null waits for the abort.
    wait: (ms, signal) =>
      new Promise<'timer' | 'resumed'>((resolve) => {
        const t = ms === null ? null : setTimeout(() => resolve('timer'), 2)
        signal.addEventListener('abort', () => {
          if (t) clearTimeout(t)
          resolve('timer')
        })
      }),
    value: (name) => values[name] ?? null,
    printAndExit: (line) => {
      p.printed.push(line)
    },
    telemetryInstallId: async () => '3f0c2a52-7a1e-4c1b-9a53-0b6c0e1d2f44',
    log: (line) => {
      p.logs.push(line)
    },
  }
  return p
}

/** Presses a button by screen title, or the first button of a screen with no note; else waits for the gate. Gives up after 7 of one title. */
function scriptedUI(press: Record<string, string> = {}) {
  const seen: GateScreen[] = []
  const opened: string[] = []
  const closed: number[] = []
  const counts: Record<string, number> = {}
  const ui: GateUI = {
    show(s) {
      seen.push(s)
      counts[s.title] = (counts[s.title] ?? 0) + 1
      if (counts[s.title]! > 6) return Promise.reject(new Error('stuck'))
      const want = press[s.title]
      if (want === 'stop') return Promise.reject(new Error('stopped'))
      if (want) return Promise.resolve(s.buttons.find((b) => b.label === want)!.action)
      if (!s.note) return Promise.resolve(s.buttons[0]!.action)
      return new Promise<GateAction>(() => {})
    },
    openUrl(url) {
      opened.push(url)
    },
    closeBrowser() {
      closed.push(opened.length)
    },
  }
  return { ui, seen, opened, closed }
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeEach(() => {
  wallets = [anonymous]
  walletStatus = 200
  installsStatus = 201
  offline = false
  requests = []
  walletRaw = null
  claimUrl = 'https://publikhq.com/claim/abc'
})

afterEach(() => {
  stopTelemetry()
})

describe('the gate words', () => {
  it('match the publik contract, word for word', () => {
    const w = (b: WalletBody): GateWallet => ({
      claimState: b.claim_state,
      claimUrl: null,
      handle: b.account?.handle ?? null,
      plan: { kind: b.plan.kind as 'none' | 'plan', label: b.plan.label },
      balanceMicros: b.balance_micros,
      topUpUrl: null,
    })
    expect(gateScreen('sign_in', null)).toEqual({ id: 'sign_in', title: WORDS.title, body: WORDS.signInBody, note: null, buttons: [{ action: 'sign_in', label: WORDS.signInButton }] })
    expect(gateScreen('unreachable', null)).toEqual({ id: 'unreachable', title: WORDS.title, body: WORDS.unreachable, note: null, buttons: [{ action: 'retry', label: WORDS.retry }] })
    expect(gateScreen('choose', w(claimedEmpty))).toMatchObject({ title: WORDS.chooseTitle, body: `You are signed in as @mann. ${WORDS.chooseBody}` })
    expect(gateScreen('choose', w(claimedEmpty)).buttons.map((b) => b.label)).toEqual([WORDS.getPlan, WORDS.ownKey])
    expect(gateScreen('choose', w(claimedPlan))).toMatchObject({ title: WORDS.connectTitle, body: `You are signed in as @mann. Your plan: Plus. ${WORDS.connectBody}` })
    expect(gateScreen('choose', w(claimedPlan)).buttons.map((b) => b.label)).toEqual([WORDS.connect, WORDS.ownKey])
    expect(gateScreen('choose', { ...w(claimedEmpty), handle: null, balanceMicros: 1_250_000 }).body).toBe(
      `You are signed in to publik. Your balance: $1.25. ${WORDS.connectBody}`,
    )
  })

  it('outside the US storefront of an App Store build: no Get a plan and no price; Connect your plan and Use my own key stay', () => {
    const w = (b: WalletBody): GateWallet => ({
      claimState: b.claim_state,
      claimUrl: null,
      handle: b.account?.handle ?? null,
      plan: { kind: b.plan.kind as 'none' | 'plan', label: b.plan.label },
      balanceMicros: b.balance_micros,
      topUpUrl: 'https://publikhq.com/wallet?top_up=1',
    })
    const empty = gateScreen('choose', w(claimedEmpty), null, undefined, false)
    expect(empty).toMatchObject({
      title: WORDS.chooseTitle,
      body: 'You are signed in as @mann. Your publik balance is empty. To get a plan, search for "publik" on Google. Or use your own key for AI in this app.',
    })
    expect(empty.buttons).toEqual([{ action: 'own_key', label: WORDS.ownKey }])
    expect(empty.body).not.toMatch(/\$|Get a plan|https?:/)
    const plan = gateScreen('choose', w(claimedPlan), null, undefined, false)
    expect(plan.buttons.map((b) => b.label)).toEqual([WORDS.connect, WORDS.ownKey])
    const balance = gateScreen('choose', { ...w(claimedEmpty), balanceMicros: 1_250_000 }, null, undefined, false)
    expect(balance.buttons.map((b) => b.label)).toEqual([WORDS.connect, WORDS.ownKey])
    // In the US storefront the words are the contract's, as above.
    expect(gateScreen('choose', w(claimedEmpty), null, undefined, true).buttons.map((b) => b.label)).toEqual([WORDS.getPlan, WORDS.ownKey])
  })

  it('the module file is what the publik scan looks for, with the slug and version of this app', () => {
    const code = readFileSync(join(__dirname, 'publik-core.ts'), 'utf8')
    for (const s of [`'${V1}/installs'`, `'${V1}/telemetry'`, `'app_${'opened'}'`, `export const APP_${'SLUG'} = 'nut-ai'`]) expect(code).toContain(s)
    expect(APP_SLUG).toBe(JSON.parse(readFileSync(join(MOBILE, 'publik-build.json'), 'utf8')).appSlug)
    expect(readFileSync(join(MOBILE, 'app.config.ts'), 'utf8')).toContain(`version: '${APP_VERSION}'`)
    expect(USES_AI).toBe(true)
  })
})

describe('ensureSignedIn against a fake publik', () => {
  it('sign in, get a plan, connect it, then count the open with the install key', async () => {
    // 1: anonymous (press Sign in) 2: anonymous (waiting) 3: the check sees the claim 4: claimed, no plan (press Get a plan) 5+: the plan is there.
    wallets = [anonymous, anonymous, claimedEmpty, claimedEmpty, claimedPlan]
    const p = phone()
    const { ui, seen, opened, closed } = scriptedUI()
    const gate = await ensureSignedIn(ui, p.device)
    expect(seen.map((s) => [s.title, s.note])).toEqual([
      [WORDS.title, null],
      [WORDS.title, WORDS.waiting],
      [WORDS.chooseTitle, null],
      [WORDS.connectTitle, null],
    ])
    // Sign in: publik's bare in-app claim page (in_app=1). Get a plan (US storefront): the site, as before.
    expect(opened).toEqual(['https://publikhq.com/claim/abc?in_app=1', 'https://publikhq.com/wallet?top_up=1'])
    // The in-app browser sheet closes once publik sees the sign-in, and again once it sees the plan.
    expect(closed).toEqual([1, 2])
    expect(gate).toMatchObject({ key: KEY, choice: 'publik', chosen: true, offline: false })
    expect(p.stored.choice).toBe('publik')
    // Every /wallet call carries the key; /installs carries none.
    expect(requests.filter((r) => r.path === `${V1}/wallet`).every((r) => r.auth === `Bearer ${KEY}`)).toBe(true)
    expect(requests.filter((r) => r.path === `${V1}/installs`).every((r) => r.auth === null)).toBe(true)
    // Usage counting starts after the gate, with the install key, in the wire format of /skills/telemetry.md.
    await until(() => requests.some((r) => r.path === `${V1}/telemetry`))
    const events = requests.filter((r) => r.path === `${V1}/telemetry`)
    expect(events.length).toBe(1)
    expect(events[0]!.auth).toBe(`Bearer ${KEY}`)
    const first = JSON.parse(events[0]!.body) as Record<string, unknown>
    expect(Object.keys(first).sort()).toEqual(['app', 'app_version', 'event', 'install_id', 'os', 'v'])
    expect(first).toMatchObject({ v: 1, app: 'nut-ai', event: 'app_opened', app_version: APP_VERSION, os: 'ios' })
  })

  it('active_session follows, and the debug line says what publik answered', { timeout: 10_000 }, async () => {
    wallets = [claimedPlan]
    const p = phone({ PUBLIK_TELEMETRY_INTERVAL_SECONDS: '1', PUBLIK_TELEMETRY_DEBUG: '1' }, { key: KEY, claimUrl: null, choice: 'publik', claimed: true })
    await ensureSignedIn(scriptedUI().ui, p.device)
    await until(() => requests.some((r) => r.path === `${V1}/telemetry` && r.body.includes('active_session')), 4_000)
    expect(requests.filter((r) => r.path === `${V1}/telemetry`).map((r) => JSON.parse(r.body).event).slice(0, 2)).toEqual(['app_opened', 'active_session'])
    expect(p.logs).toContain('publik-telemetry: app_opened -> 204')
  })

  it('Use my own key is stored, and the next start skips the plan screen', async () => {
    wallets = [claimedEmpty]
    const p = phone()
    const first = scriptedUI({ [WORDS.chooseTitle]: WORDS.ownKey })
    expect(await ensureSignedIn(first.ui, p.device)).toMatchObject({ choice: 'own_key', chosen: true })
    expect(first.seen.map((s) => s.title)).toEqual([WORDS.chooseTitle])
    stopTelemetry()
    const second = scriptedUI()
    expect(await ensureSignedIn(second.ui, p.device)).toMatchObject({ choice: 'own_key', chosen: false })
    expect(second.seen).toEqual([])
    expect(p.provisions).toBe(1)
  })

  it('no other way past the sign-in screen while publik says anonymous', async () => {
    const p = phone()
    const { ui, seen } = scriptedUI({ [WORDS.title]: WORDS.signInButton })
    await expect(ensureSignedIn(ui, p.device)).rejects.toThrow('stuck')
    expect(seen.every((s) => s.title === WORDS.title && s.buttons.length === 1)).toBe(true)
    expect(requests.some((r) => r.path === `${V1}/telemetry`)).toBe(false)
  })

  it('publik not reachable shows Retry and nothing else', async () => {
    offline = true
    const { ui, seen } = scriptedUI()
    await expect(ensureSignedIn(ui, phone().device)).rejects.toThrow('stuck')
    expect(seen.length).toBe(7)
    for (const s of seen) expect(s).toMatchObject({ title: WORDS.title, body: WORDS.unreachable, note: null, buttons: [{ action: 'retry', label: WORDS.retry }] })
  })

  it('Sign in with publik opens only the in-app claim page: never the site, also for a claim link stored by an older version', async () => {
    // publik sends no claim link: nothing opens, and the screen asks again.
    claimUrl = null
    const none = scriptedUI({ [WORDS.title]: WORDS.signInButton })
    await expect(ensureSignedIn(none.ui, phone().device)).rejects.toThrow('stuck')
    expect(none.opened).toEqual([])
    expect(none.seen[1]?.note).toBe('publik did not send a sign-in link for this phone. Click Sign in with publik to try again.')
    // A claim link an older version stored (no in_app): opened as the in-app page.
    const old = phone({}, { key: KEY, claimUrl: 'https://publikhq.com/claim/old?ref=app', choice: null, claimed: false })
    const ui = scriptedUI({ [WORDS.title]: WORDS.signInButton })
    await expect(ensureSignedIn(ui.ui, old.device)).rejects.toThrow('stuck')
    expect(ui.opened[0]).toBe('https://publikhq.com/claim/old?ref=app&in_app=1')
    expect(ui.opened.every((u) => u.includes('in_app=1'))).toBe(true)
  })

  it('outside the US storefront the plan screen opens no link, and Use my own key passes the gate', async () => {
    wallets = [claimedEmpty]
    const p = phone({}, { key: KEY, claimUrl: null, choice: null, claimed: true })
    p.device.purchaseLinks = async () => false
    const { ui, seen, opened } = scriptedUI()
    expect(await ensureSignedIn(ui, p.device)).toMatchObject({ choice: 'own_key', chosen: true })
    expect(seen.map((s) => s.buttons.map((b) => b.label))).toEqual([[WORDS.ownKey]])
    expect(opened).toEqual([])
  })

  it('outside the US storefront a plan got elsewhere shows when the person comes back to the app', async () => {
    wallets = [claimedEmpty, claimedEmpty, claimedPlan]
    const p = phone({}, { key: KEY, claimUrl: null, choice: null, claimed: true })
    p.device.purchaseLinks = async () => false
    // null: "until the app is in front again", here at once.
    p.device.wait = (ms, signal) =>
      new Promise<'timer' | 'resumed'>((resolve) => {
        const t = setTimeout(() => resolve(ms === null ? 'resumed' : 'timer'), 2)
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          resolve('timer')
        })
      })
    const seen: GateScreen[] = []
    const ui: GateUI = {
      show(s) {
        seen.push(s)
        if (s.title === WORDS.connectTitle) return Promise.resolve('connect' as GateAction)
        return new Promise<GateAction>(() => {})
      },
      openUrl() {
        throw new Error('no link may open here')
      },
    }
    expect(await ensureSignedIn(ui, p.device)).toMatchObject({ choice: 'publik', chosen: true })
    expect(seen.map((s) => s.title)).toEqual([WORDS.chooseTitle, WORDS.connectTitle])
    expect(seen[0]!.buttons.map((b) => b.label)).toEqual([WORDS.ownKey])
  })

  it('a 403 with publik\'s JSON error from GET /wallet is handled like a 401', async () => {
    walletStatus = 403
    const p = phone({}, { key: KEY, claimUrl: null, choice: 'publik' })
    const { ui, seen } = scriptedUI({ [WORDS.title]: 'stop' })
    await expect(ensureSignedIn(ui, p.device)).rejects.toThrow('stopped')
    expect(p.forgot).toBe(2)
    expect(p.provisions).toBe(1)
    expect(seen[0]).toMatchObject({ title: WORDS.title, body: 'This key is not valid.', buttons: [{ action: 'retry', label: WORDS.retry }] })
  })

  it('a revoked key (401) is forgotten and provisioned again; a second 401 waits for Retry', async () => {
    walletStatus = 401
    const p = phone({}, { key: KEY, claimUrl: null, choice: 'publik' })
    const { ui, seen } = scriptedUI({ [WORDS.title]: 'stop' })
    await expect(ensureSignedIn(ui, p.device)).rejects.toThrow('stopped')
    expect(p.forgot).toBe(2)
    expect(p.provisions).toBe(1)
    expect(seen[0]).toMatchObject({ title: WORDS.title, body: 'This key is not valid.', buttons: [{ action: 'retry', label: WORDS.retry }] })
  })

  it('a phone that cannot keep the key gets Retry, not a loop', async () => {
    const p = phone()
    p.device.provision = async () => {
      throw new Error("Calling the 'setValueWithKeyAsync' function has failed")
    }
    const { ui, seen } = scriptedUI({ [WORDS.title]: 'stop' })
    await expect(ensureSignedIn(ui, p.device)).rejects.toThrow('stopped')
    expect(seen[0]).toMatchObject({ title: WORDS.title, body: 'This phone could not keep its publik key. Restart publik Nut AI and try again.', buttons: [{ action: 'retry', label: WORDS.retry }] })
  })

  it('telemetry is off with DO_NOT_TRACK, and the gate still runs', async () => {
    wallets = [claimedPlan]
    const p = phone({ DO_NOT_TRACK: '1', PUBLIK_TELEMETRY_DEBUG: '1' })
    expect(await ensureSignedIn(scriptedUI().ui, p.device)).toMatchObject({ choice: 'publik' })
    await until(() => p.logs.length > 0)
    expect(p.logs).toContain('publik-telemetry: app_opened -> off (opt-out)')
    expect(requests.some((r) => r.path === `${V1}/telemetry`)).toBe(false)
  })
})

describe('PUBLIK_SELF_TEST', () => {
  async function selfTestLine(): Promise<string[]> {
    const p = phone({ PUBLIK_SELF_TEST: '1' })
    void ensureSignedIn(scriptedUI().ui, p.device)
    await until(() => p.printed.length > 0)
    return p.printed
  }

  it('prints the ok line only after a real GET /wallet answers', async () => {
    expect(await selfTestLine()).toEqual([`publik self-test: ok nut-ai ${APP_VERSION}`])
    expect(requests.map((r) => r.path)).toEqual([`${V1}/installs`, `${V1}/wallet`])
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ app_slug: 'nut-ai', app_version: APP_VERSION, app_token: CFG.appToken })
  })

  it('prints why it failed', async () => {
    walletStatus = 401
    expect(await selfTestLine()).toEqual(['publik self-test: failed: This key is not valid.'])
    walletStatus = 500
    expect(await selfTestLine()).toEqual(['publik self-test: failed: publik is not reachable. Check your connection.'])
    walletStatus = 200
    offline = true
    expect(await selfTestLine()).toEqual(['publik self-test: failed: publik is not reachable. Check your connection.'])
    offline = false
    installsStatus = 401
    expect(await selfTestLine()).toEqual(['publik self-test: failed: This app token is not valid. Ask the developer for a new build.'])
  })
})

describe('the defects found in the sister apps', () => {
  const html = (status: number) => () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    }) as unknown as Response

  it('a captive portal (200 HTML), a 401 page that is not publik JSON, 408 and 429 are "not reachable": the key stays', async () => {
    const answers: Array<() => Response> = [
      html(200),
      html(401),
      () => reply(408, { error: { type: 'timeout', message: 'x' } }),
      () => reply(429, { error: { type: 'rate_limited', message: 'x' } }),
    ]
    for (const raw of answers) {
      walletRaw = raw
      const p = phone({}, { key: KEY, claimUrl: null, choice: null, claimed: false })
      const { ui, seen } = scriptedUI({ [WORDS.title]: 'stop' })
      await expect(ensureSignedIn(ui, p.device)).rejects.toThrow('stopped')
      expect(p.forgot).toBe(0)
      expect(p.provisions).toBe(0)
      expect(p.stored.key).toBe(KEY)
      expect(seen[0]).toMatchObject({ body: WORDS.unreachable, buttons: [{ action: 'retry', label: WORDS.retry }] })
    }
  })

  it('a phone that signed in before opens offline, with its stored choice and no screen', async () => {
    const p = phone({}, { key: KEY, claimUrl: null, choice: 'own_key', claimed: true })
    const setUps: Array<() => void> = [
      () => {
        offline = true
      },
      () => {
        walletRaw = html(200)
      },
      () => {
        walletRaw = () => reply(503, {})
      },
    ]
    for (const setUp of setUps) {
      offline = false
      walletRaw = null
      setUp()
      const { ui, seen } = scriptedUI()
      expect(await ensureSignedIn(ui, p.device)).toMatchObject({ key: KEY, choice: 'own_key', chosen: false, offline: true })
      expect(seen).toEqual([])
      expect(p.forgot).toBe(0)
      stopTelemetry()
    }
  })

  it('a minor or an unknown age never sees the plan screen', async () => {
    wallets = [claimedEmpty]
    const p = phone({}, { key: KEY, claimUrl: null, choice: null, claimed: true })
    p.adult = false
    const { ui, seen } = scriptedUI()
    expect(await ensureSignedIn(ui, p.device)).toMatchObject({ choice: null, chosen: false })
    expect(seen).toEqual([])
    stopTelemetry()
    p.device.planAllowed = async () => {
      throw new Error('no profile table')
    }
    const again = scriptedUI()
    expect(await ensureSignedIn(again.ui, p.device)).toMatchObject({ choice: null, chosen: false })
    expect(again.seen).toEqual([])
  })

  it('no write can freeze the gate: saveChoice, noteWallet and forget may throw', async () => {
    wallets = [claimedEmpty]
    const p = phone()
    p.device.saveChoice = async () => {
      throw new Error('disk full')
    }
    p.device.noteWallet = async () => {
      throw new Error('disk full')
    }
    expect(await ensureSignedIn(scriptedUI({ [WORDS.chooseTitle]: WORDS.ownKey }).ui, p.device)).toMatchObject({ choice: 'own_key', chosen: true })
    stopTelemetry()
    walletStatus = 401
    const q = phone({}, { key: KEY, claimUrl: null, choice: null, claimed: true })
    q.device.forget = async () => {
      q.forgot += 1
      throw new Error('keychain locked')
    }
    const { ui, seen } = scriptedUI({ [WORDS.title]: 'stop' })
    await expect(ensureSignedIn(ui, q.device)).rejects.toThrow('stopped')
    expect(q.forgot).toBe(2)
    expect(seen[0]).toMatchObject({ buttons: [{ action: 'retry', label: WORDS.retry }] })
  })

  it('a store that cannot be read is "no key" (a new key), never a lockout', async () => {
    wallets = [claimedPlan]
    const p = phone({}, { key: KEY, claimUrl: null, choice: 'publik', claimed: true })
    let reads = 0
    p.device.load = async () => {
      reads += 1
      if (reads === 1) throw new Error('errSecInteractionNotAllowed')
      return { key: p.stored.key!, claimUrl: p.stored.claimUrl, choice: p.stored.choice, claimed: true }
    }
    expect(await ensureSignedIn(scriptedUI().ui, p.device)).toMatchObject({ key: KEY })
    expect(p.provisions).toBe(1)
  })

  it('Count app use off: no event at all, and the gate still runs', async () => {
    wallets = [claimedPlan]
    const p = phone({ PUBLIK_TELEMETRY_DEBUG: '1' }, { key: KEY, claimUrl: null, choice: 'publik', claimed: true })
    p.counting = false
    await ensureSignedIn(scriptedUI().ui, p.device)
    await until(() => p.logs.length > 0)
    expect(p.logs).toContain('publik-telemetry: app_opened -> off (opt-out)')
    expect(requests.some((r) => r.path === `${V1}/telemetry`)).toBe(false)
  })

  it('the timer stops in the background and after sign-out; the foreground starts it again with no second app_opened', { timeout: 10_000 }, async () => {
    wallets = [claimedPlan]
    const p = phone({ PUBLIK_TELEMETRY_INTERVAL_SECONDS: '1' }, { key: KEY, claimUrl: null, choice: 'publik', claimed: true })
    await ensureSignedIn(scriptedUI().ui, p.device)
    await until(() => requests.some((r) => r.path === `${V1}/telemetry`))
    pauseTelemetry()
    const at = requests.length
    await new Promise((r) => setTimeout(r, 1_400))
    expect(requests.length).toBe(at)
    resumeTelemetry()
    await until(() => requests.some((r) => r.body.includes('active_session')), 3_000)
    const events = requests.filter((r) => r.path === `${V1}/telemetry`).map((r) => JSON.parse(r.body).event)
    expect(events.filter((e) => e === 'app_opened')).toHaveLength(1)
    expect(events).toContain('active_session')
    stopTelemetry()
    resumeTelemetry()
    const after = requests.length
    await new Promise((r) => setTimeout(r, 1_400))
    expect(requests.length).toBe(after)
  })
})

describe('PUBLIK_GATE_MODE', () => {
  it('required: the gate before any screen (the sign-in screen first)', async () => {
    const { ui, seen } = scriptedUI({ [WORDS.title]: 'stop' })
    await expect(gateAtStart(ui, phone().device, 'required')).rejects.toThrow('stopped')
    expect(seen[0]).toMatchObject({ title: WORDS.title, body: WORDS.signInBody })
  })

  it('optional: no wall, no key minted, no request and no event before the sign-in', async () => {
    const p = phone()
    const { ui, seen } = scriptedUI()
    expect(await gateAtStart(ui, p.device, 'optional')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([])
    expect(p.provisions).toBe(0)
    expect(requests).toEqual([])
    // A key that never signed in counts nothing either.
    const q = phone({}, { key: KEY, claimUrl: null, choice: null, claimed: false })
    expect(await gateAtStart(scriptedUI().ui, q.device, 'optional')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(requests).toEqual([])
  })

  it('optional: a phone that signed in before counts its open, with no screen', async () => {
    const p = phone({}, { key: KEY, claimUrl: null, choice: 'publik', claimed: true })
    const { ui, seen } = scriptedUI()
    expect(await gateAtStart(ui, p.device, 'optional')).toBeNull()
    await until(() => requests.some((r) => r.path === `${V1}/telemetry`))
    expect(seen).toEqual([])
    expect(requests.map((r) => r.path)).toEqual([`${V1}/telemetry`])
  })

  it('optional: the self-test still runs in a test build', async () => {
    const p = phone({ PUBLIK_SELF_TEST: '1' })
    void gateAtStart(scriptedUI().ui, p.device, 'optional')
    await until(() => p.printed.length > 0)
    expect(p.printed).toEqual([`publik self-test: ok nut-ai ${APP_VERSION}`])
  })
})
