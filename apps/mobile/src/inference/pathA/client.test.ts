import { describe, expect, it, vi } from 'vitest'
import { runLabelScan, runScan, runScanWithFallback, runWebLookup } from './client'

/**
 * The cloud client against scripted responses: envelope extraction for every
 * provider, the structural-400 fallback, and the defensive JSON fishing that
 * the tool-using calls need. No network — every byte is scripted.
 */

type Call = { url: string; body: any }

function scripted(responses: Array<{ status: number; body: string }>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body } as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

const SCAN_REQ = (jsonSchema: unknown = { type: 'object' }) => ({
  provider: 'anthropic' as const,
  model: 'claude-haiku-4-5-20251001',
  credential: { kind: 'api_key' as const, value: 'sk' },
  imagesBase64: ['AAAA'],
  localSignalsBlock: '',
  jsonSchema,
})

describe('runScan envelope extraction', () => {
  it('anthropic: parses the JSON out of content[0].text and keeps REAL token counts', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          content: [{ type: 'text', text: '{"is_food":true}' }],
          usage: { input_tokens: 1200, output_tokens: 340 },
        }),
      },
    ])
    const r = await runScan(SCAN_REQ(), impl)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.raw).toEqual({ is_food: true })
      expect(r.value.inputTokens).toBe(1200)
      expect(r.value.outputTokens).toBe(340)
      // Cost is arithmetic from the catalog price, never an estimate.
      expect(r.value.costUsd).toBeCloseTo((1200 * 1 + 340 * 5) / 1_000_000, 8)
    }
  })

  it('openai: choices[0].message.content', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '{"x":1}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      },
    ])
    const r = await runScan({ ...SCAN_REQ(), provider: 'openai' }, impl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.raw).toEqual({ x: 1 })
  })

  it('gemini: candidates[0].content.parts[0].text', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"y":2}' }] } }],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 },
        }),
      },
    ])
    const r = await runScan({ ...SCAN_REQ(), provider: 'google' }, impl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.raw).toEqual({ y: 2 })
  })

  it('names the six failure states from status codes', async () => {
    for (const [status, kind] of [
      [401, 'key-invalid'],
      [402, 'quota-exhausted'],
      [404, 'model-unavailable'],
      [429, 'error-retryable'],
      [500, 'error-retryable'],
    ] as const) {
      const { impl } = scripted([{ status, body: '{}' }])
      const r = await runScan(SCAN_REQ(), impl)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.kind, `status ${status}`).toBe(kind)
    }
  })
})

describe('runScanWithFallback', () => {
  it('retries a structural 400 once with NO structured output', async () => {
    const { calls, impl } = scripted([
      { status: 400, body: '{"error":"schema not supported"}' },
      {
        status: 200,
        body: JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: {} }),
      },
    ])
    const r = await runScanWithFallback(SCAN_REQ(), impl)
    expect(r.ok).toBe(true)
    expect(r.usedSchemaFallback).toBe(true)
    expect(calls).toHaveLength(2)
    // First request carried the schema; the retry must NOT.
    expect(JSON.stringify(calls[0]!.body)).toContain('output_config')
    expect(JSON.stringify(calls[1]!.body)).not.toContain('output_config')
  })

  it('does NOT retry auth failures — a 401 is not a dialect problem', async () => {
    const { calls, impl } = scripted([{ status: 401, body: '{}' }])
    const r = await runScanWithFallback(SCAN_REQ(), impl)
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('does not loop: a 400 on the schema-free retry reports the ORIGINAL error', async () => {
    const { calls, impl } = scripted([
      { status: 400, body: '{"error":"first"}' },
      { status: 400, body: '{"error":"second"}' },
    ])
    const r = await runScanWithFallback(SCAN_REQ(), impl)
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(2)
  })
})

describe('runWebLookup JSON fishing', () => {
  it('anthropic: takes the LAST text block — tool blocks interleave before it', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          content: [
            { type: 'text', text: 'Searching…' },
            { type: 'server_tool_use', name: 'web_search' },
            { type: 'web_search_tool_result', content: [] },
            { type: 'text', text: '```json\n{"found":true,"source_url":"https://x.com","question":null,"options":[]}\n```' },
          ],
        }),
      },
    ])
    const r = await runWebLookup('anthropic', { model: 'm', itemName: 'x', brand: null }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(true)
    expect((r.raw as any).found).toBe(true)
  })

  it('openai Responses API: finds the message item in output[]', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          output: [
            { type: 'web_search_call' },
            { type: 'message', content: [{ type: 'output_text', text: '{"found":false,"source_url":null,"question":null,"options":[]}' }] },
          ],
        }),
      },
    ])
    const r = await runWebLookup('openai', { model: 'm', itemName: 'x', brand: null }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(true)
    expect((r.raw as any).found).toBe(false)
  })

  it('prose with no JSON object is schema-violation, not a crash and not offline', async () => {
    const { impl } = scripted([
      { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'I could not find anything.' }] }) },
    ])
    const r = await runWebLookup('anthropic', { model: 'm', itemName: 'x', brand: null }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(false)
    expect(r.error?.kind).toBe('schema-violation')
  })
})

describe('runLabelScan', () => {
  it('openai label scans use chat completions, not the Responses API', async () => {
    const { calls, impl } = scripted([
      { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"product_name":null}' } }] }) },
    ])
    const r = await runLabelScan('openai', { model: 'm', imageBase64: 'AAAA' }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).toContain('/v1/chat/completions')
  })
})

/**
 * publik mode: the same OpenAI bytes routed to the gateway, the settled charge
 * read from the headers, and the gateway's error envelope kept intact —
 * one link on a 402, `reprovision` on a revoked key.
 */
function scriptedWithHeaders(responses: Array<{ status: number; body: string; headers?: Record<string, string> }>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Headers(r.headers ?? {}),
      text: async () => r.body,
    } as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

const PUBLIK_REQ = (over: Partial<Parameters<typeof runScan>[0]> = {}) => ({
  provider: 'openai' as const,
  model: 'publik-balanced',
  credential: { kind: 'api_key' as const, value: 'pk' },
  imagesBase64: ['AAAA'],
  localSignalsBlock: '',
  jsonSchema: { type: 'object' },
  baseUrl: 'https://publikhq.com/api/v1',
  ...over,
})

const OPENAI_OK = JSON.stringify({ choices: [{ message: { content: '{"x":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })

describe('publik mode', () => {
  it('routes the OpenAI dialect to the gateway with the alias model', async () => {
    const { calls, impl } = scriptedWithHeaders([{ status: 200, body: OPENAI_OK }])
    const r = await runScan(PUBLIK_REQ(), impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).toBe('https://publikhq.com/api/v1/chat/completions')
    expect(calls[0]!.body.model).toBe('publik-balanced')
  })

  it('takes the cost from x-publik-charge-micros and the balance from the headers', async () => {
    const { impl } = scriptedWithHeaders([
      {
        status: 200,
        body: OPENAI_OK,
        headers: {
          'x-publik-request-id': 'r1',
          'x-publik-charge-micros': '41000',
          'x-publik-balance': '209000',
          'x-publik-claim-state': 'anonymous',
          'x-publik-starter-remaining': '209000',
          'x-publik-week-budget': 'none',
        },
      },
    ])
    const r = await runScan(PUBLIK_REQ(), impl)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.chargeUsd).toBe(0.041)
      expect(r.value.costUsd).toBe(0.041)
      expect(r.value.wallet?.balanceMicros).toBe(209000)
      expect(r.value.wallet?.starterRemainingMicros).toBe(209000)
      expect(r.value.wallet?.weekBudgetMicros).toBeNull()
      expect(r.value.wallet?.claimState).toBe('anonymous')
    }
  })

  it('without the gateway headers the cost still comes from the rate table', async () => {
    const { impl } = scriptedWithHeaders([{ status: 200, body: OPENAI_OK }])
    const r = await runScan(PUBLIK_REQ({ model: 'gpt-4o-mini', baseUrl: undefined as unknown as string }), impl)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.chargeUsd).toBeNull()
      expect(r.value.wallet).toBeUndefined()
      expect(r.value.costUsd).toBeCloseTo((10 * 0.15 + 5 * 0.6) / 1_000_000, 10)
    }
  })

  it('402 insufficient_credit → quota-exhausted with exactly one link, top_up_url', async () => {
    const body = JSON.stringify({
      error: {
        type: 'insufficient_credit',
        message: 'Not enough publik credit for this request. Link this phone and pick a plan at the link below, or use your own key.',
        claim_state: 'anonymous',
        top_up_url: 'https://publikhq.com/claim/HK7F-2QWD',
        claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
        add_credit_url: 'https://publikhq.com/dashboard/api/add',
      },
    })
    const { impl } = scriptedWithHeaders([{ status: 402, body, headers: { 'x-publik-request-id': 'r2' } }])
    const r = await runScanWithFallback(PUBLIK_REQ(), impl)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('quota-exhausted')
      expect(r.error.retryable).toBe(false)
      expect(r.error.message).toMatch(/^Not enough publik credit/)
      expect(r.error.action).toEqual({ label: 'Link this phone & pick a plan', url: 'https://publikhq.com/claim/HK7F-2QWD' })
    }
  })

  it('a 402 whose links are off publikhq.com carries no action', async () => {
    const body = JSON.stringify({ error: { type: 'insufficient_credit', claim_state: 'anonymous', top_up_url: 'https://evil.example/pay' } })
    const { impl } = scriptedWithHeaders([{ status: 402, body }])
    const r = await runScan(PUBLIK_REQ(), impl)
    expect(!r.ok && r.error.kind).toBe('quota-exhausted')
    expect(!r.ok && r.error.action).toBeUndefined()
  })

  it('401 key_revoked → key-invalid, with reprovision when the sweep says so', async () => {
    const body = JSON.stringify({ error: { type: 'key_revoked', message: 'revoked', reprovision: true } })
    const { impl } = scriptedWithHeaders([{ status: 401, body }])
    const r = await runScan(PUBLIK_REQ(), impl)
    expect(!r.ok && r.error.kind).toBe('key-invalid')
    expect(!r.ok && r.error.reprovision).toBe(true)
  })

  it('a vendor 402 with a non-JSON body keeps the vendor copy (regression)', async () => {
    const { impl } = scriptedWithHeaders([{ status: 402, body: 'Payment Required' }])
    const r = await runScan(SCAN_REQ(), impl)
    expect(!r.ok && r.error.message).toBe('Your provider account is out of credit.')
  })

  it('a structural 400 from the gateway still triggers the schema-less retry', async () => {
    const { calls, impl } = scriptedWithHeaders([
      { status: 400, body: JSON.stringify({ error: { message: 'Invalid schema', type: 'invalid_request_error' } }) },
      { status: 200, body: OPENAI_OK },
    ])
    const r = await runScanWithFallback(PUBLIK_REQ(), impl)
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.body.response_format).toEqual({ type: 'json_object' })
  })

  it('web lookup on publik: Chat Completions, no tool, choices envelope, charge from headers', async () => {
    const { calls, impl } = scriptedWithHeaders([
      {
        status: 200,
        body: JSON.stringify({ choices: [{ message: { content: '{"found":false,"source_url":null,"question":null,"options":[]}' } }] }),
        headers: { 'x-publik-request-id': 'r3', 'x-publik-charge-micros': '900', 'x-publik-balance': '208100' },
      },
    ])
    const r = await runWebLookup(
      'openai',
      { model: 'publik-fast', itemName: 'Clif Bar', brand: 'Clif', baseUrl: 'https://publikhq.com/api/v1', webSearch: false },
      { kind: 'api_key', value: 'pk' },
      impl,
    )
    expect(calls[0]!.url).toBe('https://publikhq.com/api/v1/chat/completions')
    expect(calls[0]!.body.tools).toBeUndefined()
    expect(r.ok).toBe(true)
    expect(r.raw).toEqual({ found: false, source_url: null, question: null, options: [] })
    expect(r.chargeUsd).toBe(0.0009)
    expect(r.wallet?.balanceMicros).toBe(208100)
  })

  it('label scan on publik carries baseUrl and the settled charge', async () => {
    const { calls, impl } = scriptedWithHeaders([
      {
        status: 200,
        body: JSON.stringify({ choices: [{ message: { content: '{"product_name":"x"}' } }] }),
        headers: { 'x-publik-request-id': 'r4', 'x-publik-charge-micros': '12000' },
      },
    ])
    const r = await runLabelScan('openai', { model: 'publik-balanced', imageBase64: 'AAAA', baseUrl: 'https://publikhq.com/api/v1' }, { kind: 'api_key', value: 'pk' }, impl)
    expect(calls[0]!.url).toBe('https://publikhq.com/api/v1/chat/completions')
    expect(r.ok).toBe(true)
    expect(r.chargeUsd).toBe(0.012)
  })
})
