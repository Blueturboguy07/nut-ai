import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// expo's own class, from the installed expo package: what the phone's global
// fetch throws (see ./deadline).
import { FetchError } from 'expo/src/winter/fetch/FetchErrors'
import { runLabelScan, runScanWithFallback, runWebLookup, SCAN_TIMEOUT_MS, VISION_TIMEOUT_MS } from './pathA/client'
import { validateCredential } from './pathA/validate'
import { provision, type PublikBuildConfig } from './publik-core'

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
function bodyHangsUntilAborted() {
  const impl = vi.fn(async (_url: unknown, init: { signal: AbortSignal }) => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'x-publik-request-id': 'r1' }),
      text: () =>
        new Promise<string>((_, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('Fetch request has been canceled'), { code: 'ERR_FETCH_REQUEST_CANCELED' })),
          )
        }),
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
    const cfg: PublikBuildConfig = {
      appToken: `pat_nut-ai_${'a'.repeat(32)}`,
      appSlug: 'nut-ai',
      baseUrl: PUBLIK,
      disclosureVersion: 1,
      models: { scan: 'publik-fast', text: 'publik-fast' },
    }
    const input = { cfg, installId: '11111111-2222-4333-8444-555555555555', appVersion: '0.2.0', os: 'android' as const, osVersion: '15', deviceName: 'Pixel' }
    const { impl } = hangsUntilAborted()
    const pending = provision(input, impl)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toMatchObject({ ok: false, kind: 'unavailable' })
    const dropped = vi.fn(async () => {
      throw expoDropped()
    }) as unknown as typeof fetch
    expect(await provision(input, dropped)).toMatchObject({ ok: false, kind: 'offline' })
  })
})
