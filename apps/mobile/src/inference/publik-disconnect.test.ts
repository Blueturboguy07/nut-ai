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

vi.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }))
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.2.0' } } }))
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 35 } }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void secure.set(k, v),
  deleteItemAsync: async (k: string) => void secure.delete(k),
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: {
    getItem: async (k: string) => kv.get(k) ?? null,
    setItem: async (k: string, v: string) => void kv.set(k, v),
    removeItem: async (k: string) => void kv.delete(k),
  },
}))
vi.mock('./credentials', () => ({
  loadCredential: async (slot: string) => creds.get(slot) ?? null,
  saveCredential: async (slot: string, c: { kind: 'api_key'; value: string }) => void creds.set(slot, c),
  clearCredential: async (slot: string) => void creds.delete(slot),
}))

import { disconnectPublik, refreshPublikWallet } from './publik'
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

beforeEach(() => {
  vi.useFakeTimers()
  secure.clear()
  kv.clear()
  creds.clear()
  creds.set('publik', { kind: 'api_key', value: 'pk_live_abcdefabcdef_' + 'a'.repeat(32) })
  secure.set('publik.install', JSON.stringify(INSTALL))
  kv.set('publik.wallet', JSON.stringify({ balanceMicros: 5 }))
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

  it('the wallet refresh ends after 15 s with no snapshot and keeps the stored one', async () => {
    const pending = refreshPublikWallet(silent)
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS)
    expect(await pending).toBeNull()
    expect(kv.get('publik.wallet')).toBe(JSON.stringify({ balanceMicros: 5 }))
  })
})
