import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// expo's own class, from the installed expo package: what the phone's global
// fetch throws (see ./deadline).
import { FetchError } from 'expo/src/winter/fetch/FetchErrors'
import {
  runExerciseEstimate,
  runLabelScan,
  runReceiptScan,
  runScanWithFallback,
  runWebLookup,
  SCAN_TIMEOUT_MS,
  VISION_TIMEOUT_MS,
} from './pathA/client'
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
 * rejects), and while the body is read (the headers are in, the body is not).
 * In the second case the abort does NOT reject the read on a phone (expo
 * 57.0.9 native code, blind verify r7): on iOS text() and json() never
 * settle; on Android text() resolves with the bytes read so far and json()
 * throws a SyntaxError. The two models below copy those, and every call site
 * runs against both. On nut-ai 5584518 the iOS cases never settle, and the
 * Android scan says "malformed JSON" and the Android key check says the key
 * works.
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

type Platform = 'ios' | 'android'

/**
 * A fetch whose headers arrive at once and whose body stalls until the abort,
 * read the way expo/fetch 57.0.9 reads it on each platform:
 * - ios: text() waits for "body completed", which never comes after a cancel
 *   (ExpoFetchModule.swift text/arrayBuffer; NativeResponse emitRequestCanceled).
 * - android: the cancel still marks the body completed, so text() resolves
 *   soon after the abort with the bytes read so far (ExpoFetchModule.kt text;
 *   NativeResponse.kt pump).
 * json() is expo's own: JSON.parse(await this.text()) (FetchResponse.ts).
 */
function bodyStalls(platform: Platform, status = 200, soFar = '') {
  const reads = { started: 0 }
  const impl = vi.fn(async (_url: unknown, init: { signal: AbortSignal }) => {
    const text = () => {
      reads.started++
      return new Promise<string>((resolve) => {
        if (platform === 'ios') return
        const done = () => queueMicrotask(() => resolve(soFar))
        if (init.signal.aborted) done()
        else init.signal.addEventListener('abort', done)
      })
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'x-publik-request-id': 'r1' }),
      text,
      json: async () => JSON.parse(await text()),
    } as unknown as Response
  })
  return { impl: impl as unknown as typeof fetch, reads }
}

/**
 * Advances fake time by `ms` and reports whether `pending` settled, without
 * waiting on it: a read that never settles fails the test instead of hanging it.
 */
async function settleWithin<T>(pending: Promise<T>, ms: number): Promise<{ settled: false } | { settled: true; value: T }> {
  let out: { settled: false } | { settled: true; value: T } = { settled: false }
  void pending.then((value) => {
    out = { settled: true, value }
  })
  await vi.advanceTimersByTimeAsync(ms)
  return out
}

/** `pending` is still open 1 ms before `ms` and settled at `ms`; returns its value. */
async function settlesAtDeadline<T>(pending: Promise<T>, ms: number): Promise<T> {
  const early = await settleWithin(pending, ms - 1)
  expect(early.settled).toBe(false)
  const late = await settleWithin(pending, 1)
  expect(late.settled).toBe(true)
  return (late as { settled: true; value: T }).value
}

const PLATFORMS: Platform[] = ['ios', 'android']

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

  // Blind verify r7: on iOS this never ended; on Android it said "malformed JSON".
  it.each(PLATFORMS)('%s: is the same timeout when the abort lands while the answer is being read', async (platform) => {
    const { impl, reads } = bodyStalls(platform)
    const r = await settlesAtDeadline(runScanWithFallback(SCAN, impl), SCAN_TIMEOUT_MS)
    expect(reads.started).toBe(1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('timeout-ambiguous')
    expect(r.error.retryable).toBe(false)
    expect(r.error.message).toBe(
      'publik API did not answer within 240 seconds. The call was probably still charged, so it is not retried. Check your charges before you scan this photo again.',
    )
    expect(r.error.action).toEqual({ label: 'See charges on publik', url: 'https://publikhq.com/wallet' })
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it('android: the bytes read before the abort are not an answer, even when they parse', async () => {
    const whole = JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    for (const soFar of ['{"choices":[{"message":{"content":"{\\"ite', whole]) {
      const { impl } = bodyStalls('android', 200, soFar)
      const r = await settlesAtDeadline(runScanWithFallback(SCAN, impl), SCAN_TIMEOUT_MS)
      expect(!r.ok && r.error.kind).toBe('timeout-ambiguous')
      expect(!r.ok && r.error.retryable).toBe(false)
      expect(impl).toHaveBeenCalledTimes(1)
    }
  })

  it.each(PLATFORMS)('%s: a vendor key whose answer is still being read gets its own timeout sentence', async (platform) => {
    const { impl } = bodyStalls(platform)
    const r = await settlesAtDeadline(runScanWithFallback({ ...SCAN, baseUrl: undefined, model: 'gpt-5-mini' }, impl), SCAN_TIMEOUT_MS)
    expect(!r.ok && r.error.kind).toBe('timeout-ambiguous')
    expect(!r.ok && r.error.message).toBe('The request timed out. It may still have been charged, so we will not retry automatically.')
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

describe('label, receipt, exercise and lookup calls whose answer is still being read', () => {
  const cred = SCAN.credential
  const calls: Array<[string, number, (impl: typeof fetch) => Promise<{ error?: { kind: string; retryable: boolean } }>]> = [
    ['label scan', VISION_TIMEOUT_MS, (impl) => runLabelScan('openai', { model: 'publik-fast', imageBase64: 'AAAA', baseUrl: PUBLIK }, cred, impl)],
    ['receipt scan', VISION_TIMEOUT_MS, (impl) => runReceiptScan('openai', { model: 'publik-fast', imageBase64: 'AAAA', baseUrl: PUBLIK }, cred, impl)],
    [
      'exercise estimate',
      20_000,
      (impl) => runExerciseEstimate('openai', { model: 'publik-fast', description: 'ran 5 km', weightKg: 70, baseUrl: PUBLIK }, cred, impl),
    ],
    [
      'web lookup',
      VISION_TIMEOUT_MS,
      (impl) =>
        runWebLookup('openai', { model: 'publik-fast', itemName: 'oat milk', brand: 'Oatly', baseUrl: PUBLIK, webSearch: false }, cred, impl),
    ],
  ]
  for (const platform of PLATFORMS) {
    it.each(calls)(`${platform}: the %s is a timeout at its deadline, not "malformed JSON"`, async (_name, ms, call) => {
      const { impl, reads } = bodyStalls(platform)
      const r = await settlesAtDeadline(call(impl), ms)
      expect(reads.started).toBe(1)
      expect(r.error?.kind).toBe('timeout-ambiguous')
      expect(r.error?.retryable).toBe(false)
    })
  }
})

describe('key checks whose answer is still being read', () => {
  const checks: Array<['openai' | 'anthropic' | 'google', string]> = [
    ['openai', 'gpt-5-mini'],
    ['anthropic', 'claude-haiku-4-5'],
    ['google', 'gemini-2.5-flash'],
  ]
  for (const platform of PLATFORMS) {
    it.each(checks)(`${platform}: the %s key check says it timed out at 15 s, not that the key works`, async (provider, model) => {
      const { impl, reads } = bodyStalls(platform)
      const res = await settlesAtDeadline(validateCredential(provider, model, { kind: 'api_key', value: 'k' }, impl), 15_000)
      expect(reads.started).toBe(1)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.kind).toBe('timeout-ambiguous')
        expect(res.error.message).toBe('The check timed out.')
      }
      expect(impl).toHaveBeenCalledTimes(1)
    })
  }
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
  // Blind verify r7: on iOS the json() read never ended.
  it.each(PLATFORMS)('%s: linking publik API whose answer is still being read at 15 s is "unavailable", not "malformed"', async (platform) => {
    const { impl, reads } = bodyStalls(platform, 201)
    expect(await settlesAtDeadline(provision(PROVISION_INPUT, impl), 15_000)).toEqual({ ok: false, kind: 'unavailable', status: 201 })
    expect(reads.started).toBe(1)
  })

  it('linking publik API: a body that is not JSON at all, read in time, is still "malformed"', async () => {
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

  it('the wallet read gives up after 15 s', async () => {
    const { impl } = hangsUntilAborted()
    expect(await settlesAtDeadline(fetchWallet(BASE, KEY, 'anonymous', impl), ACCOUNT_CALL_TIMEOUT_MS)).toBeNull()
  })

  // Blind verify r7: on iOS the wallet read never ended.
  it.each(PLATFORMS)('%s: the wallet read gives up after 15 s while the answer is being read', async (platform) => {
    const { impl, reads } = bodyStalls(platform)
    expect(await settlesAtDeadline(fetchWallet(BASE, KEY, 'anonymous', impl), ACCOUNT_CALL_TIMEOUT_MS)).toBeNull()
    expect(reads.started).toBe(1)
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
