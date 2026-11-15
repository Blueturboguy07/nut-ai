import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from 'expo/src/winter/fetch/FetchErrors'

/**
 * publik.ts's Disconnect and wallet refresh with the Expo stores mocked and a
 * fetch that never answers (blind verify r6, D5). Both used to await the
 * network with no limit; now each gives up after ACCOUNT_CALL_TIMEOUT_MS and
 * Disconnect still forgets the key on the phone.
 */

const secure = new Map<string, string>()
const kv = new Map<string, string>()
const creds = new Map<string, { kind: 'api_key'; value: string }>()
// Every delete in order, and the deletes that fail (a keychain that refuses).
const h = vi.hoisted(() => ({ deletes: [] as string[], failDelete: new Set<string>() }))

vi.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }))
vi.mock('expo-web-browser', () => ({ openBrowserAsync: async () => ({ type: 'cancel' }), dismissBrowser: () => undefined }))
// The build input PUBLIK_APP_TOKEN, as expo-constants writes it into a build (shaped, not real).
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.2.0', extra: { publikAppToken: 'pat_nut-ai_' + 'b'.repeat(32) } } } }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 35 },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  Linking: { openURL: async () => undefined },
}))
// The native launch switches (PUBLIK_API_BASE_URL...): none in a unit test.
vi.mock('../../modules/publik-launch', () => ({
  launchValue: () => null,
  printLineAndExit: () => undefined,
  storefrontCountry: async () => null,
  isSimulator: () => null,
  logLine: () => undefined,
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void secure.set(k, v),
  deleteItemAsync: async (k: string) => {
    if (h.failDelete.has(k)) throw new Error('errSecInteractionNotAllowed')
    h.deletes.push(k)
    secure.delete(k)
  },
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: {
    getItem: async (k: string) => kv.get(k) ?? null,
    setItem: async (k: string, v: string) => void kv.set(k, v),
    removeItem: async (k: string) => {
      h.deletes.push(k)
      kv.delete(k)
    },
  },
}))
vi.mock('./credentials', () => ({
  loadCredential: async (slot: string) => creds.get(slot) ?? null,
  saveCredential: async (slot: string, c: { kind: 'api_key'; value: string }) => void creds.set(slot, c),
  clearCredential: async (slot: string) => {
    h.deletes.push(`key.${slot}`)
    creds.delete(slot)
  },
}))

import {
  connectPublik,
  disconnectPublik,
  forgetPublikLocally,
  notePublikWallet,
  onPublikSignOut,
  publikBuildConfig,
  refreshPublikWallet,
  signOutOfPublik,
} from './publik'
import { ACCOUNT_CALL_TIMEOUT_MS } from './publik-core'

const INSTALL = {
  installId: 'i',
  claimUrl: 'https://publikhq.com/claim/A',
  claimState: 'anonymous',
  disclosureVersion: 1,
  models: { fast: 'publik-fast' },
  baseUrl: 'https://publikhq.com/api/v1',
}

/** Never answers; rejects the way expo/fetch does once its signal aborts. */
const silent = vi.fn(
  (_url: unknown, init: { signal?: AbortSignal }) =>
    new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(FetchError.createFromError(new Error('Fetch request has been canceled'))),
      )
    }),
) as unknown as typeof fetch

/**
 * Headers at once, then a body that stalls until the abort, read as expo/fetch
 * 57.0.9 reads it (see expo-fetch-timeout.test.ts): on iOS text() never
 * settles; on Android it resolves with the bytes so far ("") soon after.
 */
const stalledBody = (platform: 'ios' | 'android') =>
  vi.fn(async (_url: unknown, init: { signal: AbortSignal }) => {
    const text = () =>
      new Promise<string>((resolve) => {
        if (platform === 'android') init.signal.addEventListener('abort', () => queueMicrotask(() => resolve('')))
      })
    return { ok: true, status: 200, headers: new Headers(), text, json: async () => JSON.parse(await text()) }
  }) as unknown as typeof fetch

beforeEach(() => {
  vi.useFakeTimers()
  secure.clear()
  kv.clear()
  creds.clear()
  creds.set('publik', { kind: 'api_key', value: 'pk_live_abcdefabcdef_' + 'a'.repeat(32) })
  secure.set('publik.install', JSON.stringify(INSTALL))
  kv.set('publik.wallet', JSON.stringify({ balanceMicros: 5 }))
  h.deletes.length = 0
  h.failDelete.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('publik Disconnect and wallet refresh when publik never answers', () => {
  it('Disconnect ends after 15 s and still forgets the key, the install and the wallet', async () => {
    let done = false
    const pending = disconnectPublik(silent).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(creds.has('publik')).toBe(false)
    expect(secure.has('publik.install')).toBe(false)
    expect(kv.has('publik.wallet')).toBe(false)
  })

  it('Sign out deletes the key on the phone first; the revoke is sent after, best effort', async () => {
    let keyAtRevoke: boolean | null = null
    let installAtRevoke: boolean | null = null
    const watching = vi.fn((url: unknown, init: { signal?: AbortSignal }) => {
      keyAtRevoke = creds.has('publik')
      installAtRevoke = secure.has('publik.install')
      return (silent as unknown as (u: unknown, i: { signal?: AbortSignal }) => Promise<Response>)(url, init)
    }) as unknown as typeof fetch
    const pending = disconnectPublik(watching)
    await vi.advanceTimersByTimeAsync(0)
    // The revoke is on its way, and the key is already gone from this phone.
    expect(keyAtRevoke).toBe(false)
    expect(installAtRevoke).toBe(false)
    expect(creds.has('publik')).toBe(false)
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS)
    await pending
  })

  it('an install record that cannot be read, and no network, never stop Sign out', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Network request failed')
    }) as unknown as typeof fetch
    secure.set('publik.install', '{not json')
    await disconnectPublik(failing)
    expect(creds.has('publik')).toBe(false)
    expect(secure.has('publik.install')).toBe(false)
    expect(kv.has('publik.wallet')).toBe(false)
  })

  it('the wallet refresh ends after 15 s with no snapshot and keeps the stored one', async () => {
    const pending = refreshPublikWallet(silent)
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS)
    expect(await pending).toBeNull()
    expect(kv.get('publik.wallet')).toBe(JSON.stringify({ balanceMicros: 5 }))
  })

  // Blind verify r7: with the headers in and the body stalled, iOS never ended.
  it.each(['ios', 'android'] as const)('%s: the wallet refresh ends after 15 s also while the answer is being read', async (platform) => {
    let settled = false
    let value: unknown = 'not settled'
    void refreshPublikWallet(stalledBody(platform)).then((w) => {
      settled = true
      value = w
    })
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(value).toBeNull()
    expect(kv.get('publik.wallet')).toBe(JSON.stringify({ balanceMicros: 5 }))
  })
})

const failing = vi.fn(async () => {
  throw new TypeError('Network request failed')
}) as unknown as typeof fetch

// Review of 27bdd59, items 3 and 6.
describe('Sign out: at once, in order, and nothing written back after it', () => {
  it('Sign out shows Sign in with publik at once; the revoke goes in the background', async () => {
    let asked = 0
    const off = onPublikSignOut(() => {
      asked += 1
    })
    let revokes = 0
    const hanging = vi.fn((url: unknown, init: { signal?: AbortSignal }) => {
      revokes += 1
      return (silent as unknown as (u: unknown, i: { signal?: AbortSignal }) => Promise<Response>)(url, init)
    }) as unknown as typeof fetch
    // Resolves while the revoke has no answer yet (no timer moved).
    await signOutOfPublik(hanging)
    expect(asked).toBe(1)
    expect(revokes).toBe(1)
    expect(creds.has('publik')).toBe(false)
    expect(secure.has('publik.install')).toBe(false)
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS)
    // With no network at all, the same.
    creds.set('publik', { kind: 'api_key', value: 'pk_live_abcdefabcdef_' + 'b'.repeat(32) })
    secure.set('publik.install', JSON.stringify(INSTALL))
    await signOutOfPublik(failing)
    expect(asked).toBe(2)
    expect(creds.has('publik')).toBe(false)
    off()
  })

  it('the install record is deleted before the key, and a failed delete is not hidden', async () => {
    await disconnectPublik(failing)
    expect(h.deletes).toEqual(['publik.install', 'key.publik', 'publik.wallet'])
    creds.set('publik', { kind: 'api_key', value: 'pk_live_abcdefabcdef_' + 'a'.repeat(32) })
    secure.set('publik.install', JSON.stringify(INSTALL))
    h.failDelete.add('publik.install')
    await expect(forgetPublikLocally()).rejects.toThrow('publik.install')
    // The other deletes still ran: no failure keeps the key on this phone.
    expect(creds.has('publik')).toBe(false)
  })

  it('a wallet answer that lands after Sign out writes nothing back', async () => {
    const late = vi.fn(async () => {
      // Sign out while the call is out.
      creds.delete('publik')
      secure.delete('publik.install')
      kv.delete('publik.wallet')
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ balance_micros: 9, claim_state: 'claimed' }) }
    }) as unknown as typeof fetch
    expect(await refreshPublikWallet(late)).toBeNull()
    expect(secure.has('publik.install')).toBe(false)
    expect(kv.has('publik.wallet')).toBe(false)
  })

  it('a metered answer that lands after Sign out writes nothing back', async () => {
    creds.delete('publik')
    secure.delete('publik.install')
    kv.delete('publik.wallet')
    await notePublikWallet({ balanceMicros: 7, claimState: 'claimed' })
    expect(kv.has('publik.wallet')).toBe(false)
    expect(secure.has('publik.install')).toBe(false)
  })
})

// Review of 27bdd59, items 2, 3 and 4.
describe('connectPublik: the app token and the install ID', () => {
  const FRESH = '11111111-2222-4333-8444-555555555555'
  const minted = { key: 'pk_live_' + 'k'.repeat(12) + '_' + 'k'.repeat(32), claim_url: 'https://publikhq.com/claim/A', claim_state: 'anonymous', base_url: 'https://publikhq.com/api/v1' }
  function installs(answers: Array<[number, unknown]>) {
    const sent: Array<Record<string, unknown>> = []
    const impl = vi.fn(async (_url: unknown, init: { body?: string }) => {
      sent.push(JSON.parse(String(init.body)))
      const [status, body] = answers.shift()!
      return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }
    }) as unknown as typeof fetch
    return { impl, sent }
  }

  it('a release build uses the build input token, not the committed placeholder', () => {
    expect(publikBuildConfig().appToken).toBe('pat_nut-ai_' + 'b'.repeat(32))
  })

  it('with no key on this phone a stored install ID is never reused', async () => {
    creds.delete('publik')
    const f = installs([[201, minted]])
    expect((await connectPublik({ force: true }, f.impl)).ok).toBe(true)
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0]!.install_id).toBe(FRESH)
    expect(f.sent[0]!.app_token).toBe('pat_nut-ai_' + 'b'.repeat(32))
  })

  it('beside its key the stored install ID is reused (a Reconnect)', async () => {
    const f = installs([[201, minted]])
    expect((await connectPublik({ force: true }, f.impl)).ok).toBe(true)
    expect(f.sent.map((b) => b.install_id)).toEqual(['i'])
  })

  it('install_revoked: ONE new install with a fresh install ID, then on as usual', async () => {
    const revoked = { error: { type: 'install_revoked', message: 'This install was disconnected by its owner. Provision a new install.', reprovision: false } }
    const f = installs([
      [403, revoked],
      [201, minted],
    ])
    const r = await connectPublik({ force: true }, f.impl)
    expect(r.ok).toBe(true)
    expect(f.sent.map((b) => b.install_id)).toEqual(['i', FRESH])
    expect(r.ok && r.install.installId).toBe(FRESH)
    // Never a loop: a second install_revoked is the answer.
    const twice = installs([
      [403, revoked],
      [403, revoked],
    ])
    expect(await connectPublik({ force: true }, twice.impl)).toMatchObject({ ok: false, kind: 'install-revoked' })
    expect(twice.sent).toHaveLength(2)
  })
})
