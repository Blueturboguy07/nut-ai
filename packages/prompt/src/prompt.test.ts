import { describe, expect, it } from 'vitest'
import {
  buildAnthropicRequest, buildGeminiRequest, buildLabelScanRequest, buildLocalSignalsBlock,
  buildOpenAIRequest, buildReceiptScanRequest, buildTextJsonRequest, buildVisionJsonRequest,
  buildWebLookupRequest, cheapestModel, computeScanCost, isGeminiFreeTierBlocked, joinUrl,
  PROMPT_VERSION, providersByPrice, PROVIDER_MODELS, SYSTEM_PROMPT,
} from './index.js'

const base = {
  model: 'x', imagesBase64: ['AAAA'], localSignalsBlock: '', jsonSchema: { type: 'object' },
}

describe('the system prompt', () => {
  it('embeds its own version, so no scan can be logged without knowing its prompt', () => {
    expect(SYSTEM_PROMPT).toContain(`<prompt_version>${PROMPT_VERSION}</prompt_version>`)
  })

  it('frames the model as a perception device, not a calculator', () => {
    expect(SYSTEM_PROMPT).toMatch(/PERCEPTION device, not a calculator/)
  })

  it('states the sanity bounds that are the first line of defence against absurd output', () => {
    expect(SYSTEM_PROMPT).toMatch(/900 kcal\/100g/)
    expect(SYSTEM_PROMPT).toMatch(/2,500 kcal/)
  })

  it('requires identification and portion confidence to be reported separately', () => {
    expect(SYSTEM_PROMPT).toMatch(/SEPARATELY/)
  })

  it('demands composite dishes decompose into per-component items', () => {
    expect(SYSTEM_PROMPT).toMatch(/one item PER COMPONENT/)
    expect(SYSTEM_PROMPT).toMatch(/"cheeseburger" as a single\s+item is WRONG/)
  })

  it('tells the model to name hidden oil every single time', () => {
    expect(SYSTEM_PROMPT).toMatch(/stated_assumptions every single time/)
  })

  it('asks for companion drinks, whose omission is a 100% error on that item', () => {
    expect(SYSTEM_PROMPT).toMatch(/COMPANION DRINKS/)
  })

  it('specifies USDA-style keys, which is an IR lever rather than a style preference', () => {
    expect(SYSTEM_PROMPT).toMatch(/chicken breast, grilled/)
  })
})

describe('local signals', () => {
  it('is empty when there is nothing to say, rather than emitting a stub block', () => {
    expect(buildLocalSignalsBlock({})).toBe('')
  })

  it('labels the block as information, not instruction', () => {
    const b = buildLocalSignalsBlock({ userHint: 'leftovers' })
    expect(b).toMatch(/<user_context>/)
    expect(b).toMatch(/not instruction/)
  })

  it('includes the user’s own calibrated containers', () => {
    const b = buildLocalSignalsBlock({
      knownContainers: [{ label: 'my cereal bowl', type: 'cereal_bowl', usableMl: 480 }],
    })
    expect(b).toMatch(/my cereal bowl/)
    expect(b).toMatch(/480 ml/)
  })
})

describe('provider wire formats', () => {
  it('uses x-api-key for an Anthropic API key and Bearer for a setup token', () => {
    const k = buildAnthropicRequest(base, { kind: 'api_key', value: 'sk-ant-x' })
    const o = buildAnthropicRequest(base, { kind: 'oauth', value: 'tok' })
    expect(k.headers['x-api-key']).toBe('sk-ant-x')
    expect(k.headers['authorization']).toBeUndefined()
    expect(k.headers['anthropic-beta']).toBeUndefined()
    expect(o.headers['authorization']).toBe('Bearer tok')
    expect(o.headers['x-api-key']).toBeUndefined()
    // A setup-token 401s on /v1/messages without this, even when valid.
    expect(o.headers['anthropic-beta']).toBe('oauth-2025-04-20')
  })

  it('puts the system prompt in the system field for every provider', () => {
    const a = buildAnthropicRequest(base, { kind: 'api_key', value: 'k' }).body as any
    const g = buildGeminiRequest(base, 'k').body as any
    const o = buildOpenAIRequest(base, 'k').body as any
    expect(a.system).toBe(SYSTEM_PROMPT)
    expect(g.system_instruction.parts[0].text).toBe(SYSTEM_PROMPT)
    expect(o.messages[0].content).toBe(SYSTEM_PROMPT)
  })

  it('keeps per-scan context in the USER turn so the cached prefix stays stable', () => {
    const withCtx = { ...base, localSignalsBlock: '<user_context>hi</user_context>' }
    const a = buildAnthropicRequest(withCtx, { kind: 'api_key', value: 'k' }).body as any
    expect(a.system).toBe(SYSTEM_PROMPT)
    expect(JSON.stringify(a.messages)).toContain('user_context')
  })

  it('requests strict structured output from OpenAI', () => {
    const o = buildOpenAIRequest(base, 'k').body as any
    expect(o.response_format.json_schema.strict).toBe(true)
  })

  it('records the prompt version on every request', () => {
    for (const r of [
      buildAnthropicRequest(base, { kind: 'api_key', value: 'k' }),
      buildOpenAIRequest(base, 'k'),
      buildGeminiRequest(base, 'k'),
    ]) {
      expect(r.promptVersion).toBe(PROMPT_VERSION)
    }
  })
})

describe('the provider picker is neutral', () => {
  it('sorts by price with no recommended badge anywhere', () => {
    const order = providersByPrice()
    const costs = order.map((p) => Math.min(...PROVIDER_MODELS[p].map((m) => m.approxScanCostUsd)))
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
  })

  it('pre-selects the cheapest vision model within a provider', () => {
    for (const p of providersByPrice()) {
      const cheapest = cheapestModel(p)
      for (const m of PROVIDER_MODELS[p]) {
        expect(cheapest.approxScanCostUsd).toBeLessThanOrEqual(m.approxScanCostUsd)
      }
    }
  })
})

describe('the Gemini free tier is blocked for photo scans', () => {
  it('blocks unpaid Google keys and nothing else', () => {
    // Google's terms: "Do not submit sensitive, confidential, or personal
    // information to the Unpaid Services." A meal photo is health data.
    expect(isGeminiFreeTierBlocked('google', false)).toBe(true)
    expect(isGeminiFreeTierBlocked('google', true)).toBe(false)
    expect(isGeminiFreeTierBlocked('anthropic', false)).toBe(false)
    expect(isGeminiFreeTierBlocked('openai', false)).toBe(false)
  })
})

describe('cost', () => {
  it('computes from real token counts, not an estimate', () => {
    const c = computeScanCost('anthropic', 'claude-haiku-4-5-20251001', 1500, 800)
    expect(c).toBeCloseTo((1500 / 1e6) * 1 + (800 / 1e6) * 5, 9)
  })

  it('returns zero for an unknown model rather than inventing a price', () => {
    expect(computeScanCost('openai', 'not-a-model', 1000, 1000)).toBe(0)
  })
})

describe('base URL override', () => {
  const key = { kind: 'api_key' as const, value: 'k' }
  const PUBLIK = 'https://publikhq.com/api/v1'

  it('joinUrl composes exactly one /v1 whether the base carries it or not', () => {
    expect(joinUrl(PUBLIK, '/v1/responses')).toBe('https://publikhq.com/api/v1/responses')
    expect(joinUrl(`${PUBLIK}/`, '/v1/chat/completions')).toBe('https://publikhq.com/api/v1/chat/completions')
    expect(joinUrl('https://api.openai.com', '/v1/responses')).toBe('https://api.openai.com/v1/responses')
    expect(joinUrl('https://api.anthropic.com/', '/v1/messages')).toBe('https://api.anthropic.com/v1/messages')
  })

  it('with no baseUrl every builder emits the pre-patch vendor literal', () => {
    // The eval harness diffs request bytes; these fifteen URLs are the contract.
    expect(buildAnthropicRequest(base, key).url).toBe('https://api.anthropic.com/v1/messages')
    expect(buildOpenAIRequest(base, 'k').url).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildGeminiRequest(base, 'k').url).toBe('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')

    const text = { model: 'x', instruction: 'i' }
    expect(buildTextJsonRequest('anthropic', text, key, 'v').url).toBe('https://api.anthropic.com/v1/messages')
    expect(buildTextJsonRequest('openai', text, key, 'v').url).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildTextJsonRequest('google', text, key, 'v').url).toBe('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')

    const vision = { model: 'x', imageBase64: 'AAAA', instruction: 'i' }
    expect(buildVisionJsonRequest('anthropic', vision, key, 'v').url).toBe('https://api.anthropic.com/v1/messages')
    expect(buildVisionJsonRequest('openai', vision, key, 'v').url).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildVisionJsonRequest('google', vision, key, 'v').url).toBe('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')

    const label = { model: 'x', imageBase64: 'AAAA' }
    expect(buildLabelScanRequest('anthropic', label, key).url).toBe('https://api.anthropic.com/v1/messages')
    expect(buildLabelScanRequest('openai', label, key).url).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildLabelScanRequest('google', label, key).url).toBe('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')

    const web = { model: 'x', itemName: 'n', brand: null }
    expect(buildWebLookupRequest('anthropic', web, key).url).toBe('https://api.anthropic.com/v1/messages')
    expect(buildWebLookupRequest('openai', web, key).url).toBe('https://api.openai.com/v1/responses')
    expect(buildWebLookupRequest('google', web, key).url).toBe('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')

    expect(buildReceiptScanRequest('openai', label, key).url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('with baseUrl the OpenAI vision builder targets publik and the body is byte-identical', () => {
    const vendor = buildOpenAIRequest(base, 'k')
    const proxied = buildOpenAIRequest({ ...base, baseUrl: PUBLIK }, 'k')
    expect(proxied.url).toBe('https://publikhq.com/api/v1/chat/completions')
    expect(JSON.stringify(proxied.body)).toBe(JSON.stringify(vendor.body))
    expect(proxied.headers).toEqual(vendor.headers)
  })

  it('threads baseUrl through every other builder', () => {
    const text = { model: 'x', instruction: 'i', baseUrl: PUBLIK }
    expect(buildTextJsonRequest('openai', text, key, 'v').url).toBe('https://publikhq.com/api/v1/chat/completions')
    const vision = { model: 'x', imageBase64: 'AAAA', instruction: 'i', baseUrl: PUBLIK }
    expect(buildVisionJsonRequest('openai', vision, key, 'v').url).toBe('https://publikhq.com/api/v1/chat/completions')
    const label = { model: 'x', imageBase64: 'AAAA', baseUrl: PUBLIK }
    expect(buildLabelScanRequest('openai', label, key).url).toBe('https://publikhq.com/api/v1/chat/completions')
    expect(buildReceiptScanRequest('openai', label, key).url).toBe('https://publikhq.com/api/v1/chat/completions')
    const web = { model: 'x', itemName: 'n', brand: null, baseUrl: PUBLIK }
    expect(buildWebLookupRequest('openai', web, key).url).toBe('https://publikhq.com/api/v1/responses')
    expect(buildWebLookupRequest('anthropic', web, key).url).toBe('https://publikhq.com/api/v1/messages')
  })

  it('webSearch: false drops the Responses tool and uses Chat Completions', () => {
    const web = { model: 'publik-fast', itemName: 'n', brand: null, baseUrl: PUBLIK, webSearch: false }
    const r = buildWebLookupRequest('openai', web, key)
    expect(r.url).toBe('https://publikhq.com/api/v1/chat/completions')
    const body = r.body as any
    expect(body.tools).toBeUndefined()
    expect(body.messages[0].role).toBe('user')
    expect(body.response_format).toEqual({ type: 'json_object' })
    // Default (and explicit true) keeps the search tool for a BYO OpenAI key.
    const t = buildWebLookupRequest('openai', { ...web, webSearch: true }, key).body as any
    expect(t.tools).toEqual([{ type: 'web_search' }])
  })
})

/**
 * Oct 2 2026: on publik's balanced tier (a reasoning model) a meal photo
 * spent 1,000-2,000 tokens thinking INSIDE the 4,096 cap and seven scans in
 * a row were billed with the JSON cut mid-item or no answer at all. The caps
 * and the effort hint below are what changed.
 */
describe('output caps and reasoning effort', () => {
  const key = { kind: 'api_key' as const, value: 'k' }

  it('a scan asks for 8,192 output tokens on every dialect', () => {
    expect((buildAnthropicRequest(base, key).body as any).max_tokens).toBe(8192)
    expect((buildOpenAIRequest(base, 'k').body as any).max_tokens).toBe(8192)
    expect((buildGeminiRequest(base, 'k').body as any).generationConfig.maxOutputTokens).toBe(8192)
    // An explicit budget still wins.
    expect((buildOpenAIRequest({ ...base, maxTokens: 1000 }, 'k').body as any).max_tokens).toBe(1000)
  })

  it('a label scan asks for 2,048 and a tool-less web lookup for 4,096', () => {
    const label = { model: 'x', imageBase64: 'AAAA' }
    expect((buildLabelScanRequest('anthropic', label, key).body as any).max_tokens).toBe(2048)
    expect((buildLabelScanRequest('openai', label, key).body as any).max_tokens).toBe(2048)
    expect((buildLabelScanRequest('google', label, key).body as any).generationConfig.maxOutputTokens).toBe(2048)
    const web = { model: 'x', itemName: 'n', brand: null, webSearch: false }
    expect((buildWebLookupRequest('openai', web, key).body as any).max_tokens).toBe(4096)
    expect((buildWebLookupRequest('anthropic', { ...web, webSearch: true }, key).body as any).max_tokens).toBe(4096)
  })

  it('reasoning_effort is sent only when asked for, and only in the OpenAI dialect', () => {
    expect((buildOpenAIRequest(base, 'k').body as any).reasoning_effort).toBeUndefined()
    const o = buildOpenAIRequest({ ...base, reasoningEffort: 'low' }, 'k').body as any
    expect(o.reasoning_effort).toBe('low')
    // The other dialects have no such field; the hint must not leak into them.
    expect(JSON.stringify(buildAnthropicRequest({ ...base, reasoningEffort: 'low' }, key).body)).not.toContain('reasoning')
    expect(JSON.stringify(buildGeminiRequest({ ...base, reasoningEffort: 'low' }, 'k').body)).not.toContain('reasoning')
  })
})
