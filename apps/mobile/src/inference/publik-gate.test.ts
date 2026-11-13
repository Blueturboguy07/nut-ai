import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APP_SLUG,
  APP_VERSION,
  ensureSignedIn,
  gateScreen,
  provision,
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
    return reply(201, { key: KEY, install_id: JSON.parse(String(init?.body)).install_id, claim_url: 'https://publikhq.com/claim/abc', claim_state: 'anonymous' })
  }
  if (path === `${V1}/wallet`) {
    if (walletStatus !== 200) return reply(walletStatus, { error: { type: 'invalid_key', message: 'This key is not valid.' } })
    const w = wallets.length > 1 ? wallets.shift()! : wallets[0]!
    return reply(200, { ...w, claim_url: 'https://publikhq.com/claim/abc', top_up_url: 'https://publikhq.com/wallet?top_up=1', linked_at: null })
  }
  if (path === `${V1}/telemetry`) return reply(204, null)
  return reply(404, {})
}) as unknown as typeof fetch

interface Phone {
  device: GateDevice
  stored: { key: string | null; claimUrl: string | null; choice: Choice | null }
  provisions: number
  forgot: number
  printed: string[]
  logs: string[]
}

function phone(values: Record<string, string> = {}, prior?: Phone['stored']): Phone {
  const p: Phone = {
    stored: prior ?? { key: null, claimUrl: null, choice: null },
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
    load: async () => (p.stored.key ? { key: p.stored.key, claimUrl: p.stored.claimUrl, choice: p.stored.choice } : null),
    provision: async () => {
      p.provisions += 1
      const r = await provision(
        { cfg: CFG, installId: '11111111-2222-4333-8444-555555555555', appVersion: APP_VERSION, os: 'ios', osVersion: '18.6', deviceName: 'iPhone' },
        fakeFetch,
      )
      if (r.ok) p.stored = { key: r.key, claimUrl: r.install.claimUrl, choice: p.stored.choice }
      return r
    },
    forget: async () => {
      p.forgot += 1
      p.stored = { key: null, claimUrl: null, choice: null }
    },
    saveChoice: async (choice) => {
      p.stored = { ...p.stored, choice }
    },
    noteWallet: async () => undefined,
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
  }
  return { ui, seen, opened }
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
    const { ui, seen, opened } = scriptedUI()
    const gate = await ensureSignedIn(ui, p.device)
    expect(seen.map((s) => [s.title, s.note])).toEqual([
      [WORDS.title, null],
      [WORDS.title, WORDS.waiting],
      [WORDS.chooseTitle, null],
      [WORDS.connectTitle, null],
    ])
    expect(opened).toEqual(['https://publikhq.com/claim/abc', 'https://publikhq.com/wallet?top_up=1'])
    expect(gate).toMatchObject({ key: KEY, choice: 'publik', chosen: true })
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
    const p = phone({ PUBLIK_TELEMETRY_INTERVAL_SECONDS: '1', PUBLIK_TELEMETRY_DEBUG: '1' }, { key: KEY, claimUrl: null, choice: 'publik' })
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

  it('a revoked key (401) is forgotten and provisioned again; a second 401 waits for Retry', async () => {
    walletStatus = 401
    const p = phone({}, { key: KEY, claimUrl: null, choice: 'publik' })
    const { ui, seen } = scriptedUI({ [WORDS.title]: 'stop' })
    await expect(ensureSignedIn(ui, p.device)).rejects.toThrow('stopped')
    expect(p.forgot).toBe(2)
    expect(p.provisions).toBe(1)
    expect(seen[0]).toMatchObject({ title: WORDS.title, body: 'This key is not valid.', buttons: [{ action: 'retry', label: WORDS.retry }] })
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
    walletStatus = 500
    expect(await selfTestLine()).toEqual(['publik self-test: failed: This key is not valid.'])
    walletStatus = 200
    offline = true
    expect(await selfTestLine()).toEqual(['publik self-test: failed: publik is not reachable. Check your connection.'])
    offline = false
    installsStatus = 401
    expect(await selfTestLine()).toEqual(['publik self-test: failed: This app token is not valid. Ask the developer for a new build.'])
  })
})
