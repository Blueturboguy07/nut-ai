import { ANTHROPIC_BASE_URL, ANTHROPIC_OAUTH_BETA, GEMINI_BASE_URL, joinUrl, OPENAI_BASE_URL } from './providers.js'
import type { ProviderId, ProviderRequest } from './providers.js'

/**
 * Web-search refinement for branded and restaurant food.
 *
 * The local corpus is USDA — deep on generic and chain-restaurant staples, blind
 * to this month's menu items and most branded SKUs. When the resolver misses on
 * an item the model believes is branded, a SECOND call runs with the provider's
 * own server-side web-search tool and asks it to transcribe the brand's
 * published nutrition facts.
 *
 * Design rules, in order of importance:
 *
 *   TRANSCRIBE, DON'T ESTIMATE. The prompt demands numbers read off the brand's
 *   published nutrition page with the URL attached. D16 still holds in spirit:
 *   the number the user sees traces to a published document, not model priors.
 *
 *   AMBIGUITY BECOMES OPTIONS WITH DATA, NOT A QUESTION ALONE. If the photo
 *   can't distinguish menu variants, the model returns up to six options — EACH
 *   carrying its own published macros — so answering the question is a local
 *   snapshot swap: free, instant, offline. One search pays for the whole
 *   disambiguation.
 *
 *   NO STRUCTURED-OUTPUT MODE. Search tools and schema enforcement don't compose
 *   reliably on every provider (Gemini rejects the combination outright), so
 *   this call is prompt-shaped JSON validated client-side by WebLookupResultZ —
 *   uniform across all three providers.
 */

export const WEB_LOOKUP_PROMPT_VERSION = 'weblookup-1'

export function buildWebLookupInstruction(input: {
  itemName: string
  brand: string | null
  visualContext?: string | null
}): string {
  const subject = input.brand ? `${input.brand} — ${input.itemName}` : input.itemName
  return [
    `Find the OFFICIAL published nutrition facts for this food: "${subject}".`,
    input.visualContext ? `Visual context from the photo: ${input.visualContext}` : '',
    '',
    'Rules:',
    '- Prefer the brand or restaurant\'s own nutrition page; a regulator or major nutrition database is acceptable when the brand publishes nothing.',
    '- TRANSCRIBE values exactly as published. Never estimate, average, or fill gaps from general knowledge. A nutrient the source does not list is null.',
    '- If the description matches several menu items or variants (size, flavor, preparation), return up to 6 of the closest as separate options, EACH with its own published values, and set "question" to a short question a user could answer at a glance (e.g. "Which sandwich was it?").',
    '- If exactly one item matches, return it as the single option and set "question" to null.',
    '- If you cannot find published facts, set "found" to false and return an empty options array.',
    '',
    'Respond with ONLY this JSON object, no prose:',
    '{"found": boolean, "source_url": string|null, "question": string|null, "options": [{"label": string, "serving_g": number|null, "serving_desc": string|null, "calories_kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number|null, "sodium_mg": number|null}]}',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface WebLookupRequestInput {
  model: string
  itemName: string
  brand: string | null
  visualContext?: string | null
  /** Proxy origin; absent means the vendor's own host. */
  baseUrl?: string
  /**
   * OpenAI only. `false` skips the server-side web_search tool and asks the
   * model on Chat Completions instead — the route publik API takes, because
   * the tool's per-call surcharge is not metered there yet. The instruction
   * already tells the model to answer `found: false` rather than guess, so a
   * lookup without search degrades to "not found", never to an invention.
   */
  webSearch?: boolean
}

export function buildAnthropicWebLookupRequest(
  input: WebLookupRequestInput,
  credential: { kind: 'api_key' | 'oauth'; value: string },
): ProviderRequest {
  const headers: Record<string, string> =
    credential.kind === 'api_key'
      ? { 'x-api-key': credential.value, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : {
          authorization: `Bearer ${credential.value}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': ANTHROPIC_OAUTH_BETA,
          'content-type': 'application/json',
        }
  return {
    url: joinUrl(input.baseUrl ?? ANTHROPIC_BASE_URL, '/v1/messages'),
    headers,
    body: {
      model: input.model,
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: buildWebLookupInstruction(input) }],
    },
    promptVersion: WEB_LOOKUP_PROMPT_VERSION,
  }
}

/**
 * OpenAI's web_search tool lives on the RESPONSES API, not chat completions —
 * a different url, request shape, and response envelope from the scan call.
 */
export function buildOpenAIWebLookupRequest(input: WebLookupRequestInput, apiKey: string): ProviderRequest {
  if (input.webSearch === false) return buildOpenAIWebLookupNoToolRequest(input, apiKey)
  return {
    url: joinUrl(input.baseUrl ?? OPENAI_BASE_URL, '/v1/responses'),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: {
      model: input.model,
      tools: [{ type: 'web_search' }],
      input: buildWebLookupInstruction(input),
    },
    promptVersion: WEB_LOOKUP_PROMPT_VERSION,
  }
}

/**
 * The tool-less sibling: same instruction, Chat Completions envelope, no
 * `tools`. The response is `choices[0].message.content`, which the client's
 * OpenAI branch already reads.
 */
export function buildOpenAIWebLookupNoToolRequest(input: WebLookupRequestInput, apiKey: string): ProviderRequest {
  return {
    url: joinUrl(input.baseUrl ?? OPENAI_BASE_URL, '/v1/chat/completions'),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: {
      model: input.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: buildWebLookupInstruction(input) }],
      response_format: { type: 'json_object' },
    },
    promptVersion: WEB_LOOKUP_PROMPT_VERSION,
  }
}

export function buildGeminiWebLookupRequest(input: WebLookupRequestInput, apiKey: string): ProviderRequest {
  return {
    url: joinUrl(input.baseUrl ?? GEMINI_BASE_URL, `/v1beta/models/${encodeURIComponent(input.model)}:generateContent`),
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: {
      contents: [{ role: 'user', parts: [{ text: buildWebLookupInstruction(input) }] }],
      // google_search cannot be combined with responseSchema — JSON shape is
      // enforced by the prompt and validated client-side instead.
      tools: [{ google_search: {} }],
    },
    promptVersion: WEB_LOOKUP_PROMPT_VERSION,
  }
}

export function buildWebLookupRequest(
  provider: ProviderId,
  input: WebLookupRequestInput,
  credential: { kind: 'api_key' | 'oauth'; value: string },
): ProviderRequest {
  if (provider === 'anthropic') return buildAnthropicWebLookupRequest(input, credential)
  if (provider === 'openai') return buildOpenAIWebLookupRequest(input, credential.value)
  return buildGeminiWebLookupRequest(input, credential.value)
}
