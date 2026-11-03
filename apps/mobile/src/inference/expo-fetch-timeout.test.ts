import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// expo's own class, from the installed expo package: what the phone's global
// fetch throws (see ./deadline).
import { FetchError } from 'expo/src/winter/fetch/FetchErrors'
import { runLabelScan, runScanWithFallback, runWebLookup, SCAN_TIMEOUT_MS, VISION_TIMEOUT_MS } from './pathA/client'
import { validateCredential } from './pathA/validate'
import { ACCOUNT_CALL_TIMEOUT_MS, fetchWallet, provision, revokeInstall, type PublikBuildConfig } from './publik-core'

/**
 * A timeout on a phone, as the phone really reports it.
 *
 * Expo 57 makes expo/fetch the app's global fetch. When the signal aborts,
 * expo calls the native request's cancel(), the native side rejects with
 * FetchRequestCanceledException ("Fetch request has been canceled"), and
 * expo/fetch rethrows that as FetchError.createFromError(e): message
 * "fetch failed: Fetch request has been canceled", name "Error". It is never
 * an AbortError. The app used to decide "timeout" from the name, so on a
 * phone every timeout came out as "offline": "check the connection" and a
 * Retry button for a call the gateway had most likely charged (blind verify,
 * Nov 2 2026). These tests throw that exact shape; on nut-ai dace891 the
 * timeout cases here fail.
 *
 * Two places the abort can land: before the response (fetch itself
 * rejects), and while the body is read (the gateway answered with headers
 * and heartbeat bytes, then text() rejects with the native error).
 */

/** What expo/fetch throws when its signal aborts the request. */
function expoCanceled(): Error {
  const native = Object.assign(new Error('Fetch request has been canceled'), { code: 'ERR_FETCH_REQUEST_CANCELED' })
  return FetchError.createFromError(native)
}

/** What expo/fetch throws when the connection fails (no abort). */
function expoDropped(): Error {
  return FetchError.createFromError(new Error('Unable to resolve host "publikhq.com"'))
}

/** A fetch that never answers and rejects the way expo does once its signal aborts. */
function hangsUntilAborted() {
  const seen: { signal?: AbortSignal } = {}
  const impl = vi.fn(
    (_url: unknown, init: { signal: AbortSignal }) =>
      new Promise<Response>((_, reject) => {
        seen.signal = init.signal
        init.signal.addEventListener('abort', () => reject(expoCanceled()))
      }),
  )
  return { seen, impl: impl as unknown as typeof fetch }
}

/** A fetch whose headers arrive at once (the gateway's heartbeat) and whose body never ends. */
function bodyHangsUntilAborted(status = 200) {
  const impl = vi.fn(async (_url: unknown, init: { signal: AbortSignal }) => {
    const body = () =>
      new Promise<never>((_, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('Fetch request has been canceled'), { code: 'ERR_FETCH_REQUEST_CANCELED' })),
        )
      })
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'x-publik-request-id': 'r1' }),
      text: body,
      json: body,
    } as unknown as Response
  })
  return impl as unknown as typeof fetch
}

const PUBLIK = 'https://publikhq.com/api/v1'
const SCAN = {
  provider: 'openai' as const,
  model: 'publik-balanced',
  credential: { kind: 'api_key' as const, value: 'pk' },
  imagesBase64: ['AAAA'],
  localSignalsBlock: '',
  jsonSchema: { type: 'object' },
  baseUrl: PUBLIK,
}

const PROVISION_CFG: PublikBuildConfig = {
  appToken: `pat_nut-ai_${'a'.repeat(32)}`,
  appSlug: 'nut-ai',
  baseUrl: PUBLIK,
  disclosureVersion: 1,
  models: { scan: 'publik-fast', text: 'publik-fast' },
}
const PROVISION_INPUT = {
  cfg: PROVISION_CFG,
  installId: '11111111-2222-4333-8444-555555555555',
  appVersion: '0.2.0',
  os: 'android' as const,
  osVersion: '15',
  deviceName: 'Pixel',
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('expo/fetch: the abort shape', () => {
  it('is a FetchError named "Error", not an AbortError', () => {
    const e = expoCanceled()
    expect(e).toBeInstanceOf(FetchError)
    expect(e.name).toBe('Error')
    expect(e.message).toBe('fetch failed: Fetch request has been canceled')
  })
})

describe('a meal scan on a phone that waits too long', () => {
  it('waits 240 s, then says the call was probably charged, links the charges and offers no Retry', async () => {
    const { seen, impl } = hangsUntilAborted()
    const pending = runScanWithFallback(SCAN, impl)
    await vi.advanceTimersByTimeAsync(150_001)
    expect(seen.signal!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS - 150_001)
    expect(seen.signal!.aborted).toBe(true)
    const r = await pending
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('timeout-ambiguous')
    expect(r.error.retryable).toBe(false)
    expect(r.error.message).toBe(
      'publik API did not answer within 240 seconds. The call was probably still charged, so it is not retried. Check your charges before you scan this photo again.',
    )
    expect(r.error.message).not.toMatch(/connection/i)
    expect(r.error.action).toEqual({ label: 'See charges on publik', url: 'https://publikhq.com/wallet' })
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it('is a timeout too when the abort lands while the answer is being read', async () => {
    const pending = runScanWithFallback(SCAN, bodyHangsUntilAborted())
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS)
    const r = await pending
    expect(!r.ok && r.error.kind).toBe('timeout-ambiguous')
    expect(!r.ok && r.error.retryable).toBe(false)
  })

  it('a vendor key gets the same kind, with its own sentence', async () => {
    const { impl } = hangsUntilAborted()
    const pending = runScanWithFallback({ ...SCAN, baseUrl: undefined, model: 'gpt-5-mini' }, impl)
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS)
    const r = await pending
    expect(!r.ok && r.error.kind).toBe('timeout-ambiguous')
    expect(!r.ok && r.error.message).toBe('The request timed out. It may still have been charged, so we will not retry automatically.')
  })

  it('the same FetchError before the deadline is a dropped connection: offline and retryable', async () => {
    const impl = vi.fn(async () => {
      throw expoDropped()
    }) as unknown as typeof fetch
    const r = await runScanWithFallback(SCAN, impl)
    expect(!r.ok && r.error.kind).toBe('offline')
    expect(!r.ok && r.error.retryable).toBe(true)
    expect(!r.ok && r.error.message).toContain('Check the connection on this phone')
  })
})

describe('label, receipt and lookup calls on a phone', () => {
  it('a label scan that waits 90 s is a timeout, not offline', async () => {
    const { impl } = hangsUntilAborted()
    const pending = runLabelScan('openai', { model: 'publik-fast', imageBase64: 'AAAA', baseUrl: PUBLIK }, SCAN.credential, impl)
    await vi.advanceTimersByTimeAsync(VISION_TIMEOUT_MS)
    const r = await pending
    expect(r.error?.kind).toBe('timeout-ambiguous')
    expect(r.error?.retryable).toBe(false)
    expect(r.error?.message).toContain('90 seconds')
  })

  it('a web lookup that waits 90 s is a timeout, not offline', async () => {
    const { impl } = hangsUntilAborted()
    const pending = runWebLookup(
      'openai',
      { model: 'publik-fast', itemName: 'oat milk', brand: 'Oatly', baseUrl: PUBLIK, webSearch: false },
      SCAN.credential,
      impl,
    )
    await vi.advanceTimersByTimeAsync(VISION_TIMEOUT_MS)
    const r = await pending
    expect(r.error?.kind).toBe('timeout-ambiguous')
    expect(r.error?.retryable).toBe(false)
  })
})

describe('the key check and the publik link on a phone', () => {
  it('a key check that waits 15 s says it timed out, not "No connection"', async () => {
    const { impl } = hangsUntilAborted()
    const pending = validateCredential('openai', 'gpt-5-mini', { kind: 'api_key', value: 'k' }, impl)
    await vi.advanceTimersByTimeAsync(15_000)
    const res = await pending
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('timeout-ambiguous')
      expect(res.error.message).toBe('The check timed out.')
    }
  })

  it('linking publik API that waits 15 s is "unavailable"; the same FetchError at once is "offline"', async () => {
    const input = PROVISION_INPUT
    const { impl } = hangsUntilAborted()
    const pending = provision(input, impl)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toMatchObject({ ok: false, kind: 'unavailable' })
    const dropped = vi.fn(async () => {
      throw expoDropped()
    }) as unknown as typeof fetch
    expect(await provision(input, dropped)).toMatchObject({ ok: false, kind: 'offline' })
  })

  // Blind verify r6, D6: the abort landing in res.json() said "Update Nut AI".
  it('linking publik API whose answer is still being read at 15 s is "unavailable", not "malformed"', async () => {
    const pending = provision(PROVISION_INPUT, bodyHangsUntilAborted(201))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toEqual({ ok: false, kind: 'unavailable', status: 201 })
    // A body that is not JSON at all is still "malformed".
    const garbage = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
    })) as unknown as typeof fetch
    expect(await provision(PROVISION_INPUT, garbage)).toEqual({ ok: false, kind: 'malformed', status: 201 })
  })
})

// Blind verify r6, D5: Disconnect and the wallet card waited without limit.
describe('Disconnect and the wallet read on a phone', () => {
  const BASE = 'https://publikhq.com/api/v1/'
  const KEY = 'pk_live_abcdefabcdef_' + 'a'.repeat(32)

  it('the revoke gives up after 15 s and reports it; it does not wait longer', async () => {
    expect(ACCOUNT_CALL_TIMEOUT_MS).toBe(15_000)
    const { seen, impl } = hangsUntilAborted()
    let settled = false
    const pending = revokeInstall(BASE, KEY, impl).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe('timed-out')
    expect(seen.signal!.aborted).toBe(true)
    expect(impl).toHaveBeenCalledWith('https://publikhq.com/api/v1/installs/revoke', expect.objectContaining({ method: 'POST' }))
  })

  it('the revoke reports a dropped connection, a refusal and a success', async () => {
    const dropped = vi.fn(async () => {
      throw expoDropped()
    }) as unknown as typeof fetch
    expect(await revokeInstall(BASE, KEY, dropped)).toBe('offline')
    const refused = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch
    expect(await revokeInstall(BASE, KEY, refused)).toBe('refused')
    const done = vi.fn(async () => ({ ok: true, status: 204 })) as unknown as typeof fetch
    expect(await revokeInstall(BASE, KEY, done)).toBe('revoked')
  })

  it('the wallet read gives up after 15 s, also while the answer is being read', async () => {
    const { impl } = hangsUntilAborted()
    const pending = fetchWallet(BASE, KEY, 'anonymous', impl)
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS)
    expect(await pending).toBeNull()
    const slowBody = fetchWallet(BASE, KEY, 'anonymous', bodyHangsUntilAborted())
    await vi.advanceTimersByTimeAsync(ACCOUNT_CALL_TIMEOUT_MS)
    expect(await slowBody).toBeNull()
  })

  it('the wallet read still returns the snapshot when publik answers', async () => {
    const ok = vi.fn(async (_url: unknown, init: { signal: AbortSignal; headers: Record<string, string> }) => {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.headers.authorization).toBe(`Bearer ${KEY}`)
      return { ok: true, status: 200, json: async () => ({ balance_micros: 1_250_000, claim_state: 'claimed' }) }
    }) as unknown as typeof fetch
    const w = await fetchWallet(BASE, KEY, 'anonymous', ok)
    expect(w?.balanceMicros).toBe(1_250_000)
    expect(ok).toHaveBeenCalledWith('https://publikhq.com/api/v1/wallet', expect.anything())
  })
})
