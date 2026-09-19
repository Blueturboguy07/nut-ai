import { ANTHROPIC_BASE_URL, ANTHROPIC_OAUTH_BETA, GEMINI_BASE_URL, joinUrl, OPENAI_BASE_URL } from './providers.js'
import type { ProviderId, ProviderRequest } from './providers.js'

/**
 * Nutrition-label transcription requests.
 *
 * One image, one instruction, no tools, no structured-output mode — the JSON is
 * validated client-side by LabelPayloadZ. The instruction is explicit that this
 * is COPYING, because the failure mode worth designing against is a model
 * "helpfully" normalizing a label's numbers to what it believes they should be.
 */

export const LABEL_SCAN_PROMPT_VERSION = 'label-scan-v1'

export const LABEL_SCAN_INSTRUCTION = [
  'The photo shows a printed nutrition facts label. TRANSCRIBE it — copy the numbers exactly as printed. Do not estimate, correct, or normalize anything, even if a printed value looks wrong to you.',
  '',
  'Rules:',
  '- Values are PER SERVING as printed, not per container.',
  '- serving_g is the gram figure printed with the serving size, e.g. the 170 in "3/4 cup (170g)". If no gram figure is printed anywhere, set it to null — never infer one.',
  '- A nutrient the label does not list is null. A printed 0 is 0. These are different.',
  '- product_name only if a product name is visible in the photo; otherwise null.',
  '- If the photo does not show a legible nutrition label, set every field to null and per_serving values to 0.',
  '',
  'Respond with ONLY this JSON object:',
  '{"product_name": string|null, "serving_desc": string|null, "serving_g": number|null, "servings_per_container": number|null, "per_serving": {"calories_kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number|null, "sugar_g": number|null, "sodium_mg": number|null}}',
].join('\n')

export interface LabelScanInput {
  model: string
  imageBase64: string
  /** Proxy origin; absent means the vendor's own host. */
  baseUrl?: string
}

export function buildLabelScanRequest(
  provider: ProviderId,
  input: LabelScanInput,
  credential: { kind: 'api_key' | 'oauth'; value: string },
): ProviderRequest {
  if (provider === 'anthropic') {
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
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 } },
              { type: 'text', text: LABEL_SCAN_INSTRUCTION },
            ],
          },
        ],
      },
      promptVersion: LABEL_SCAN_PROMPT_VERSION,
    }
  }

  if (provider === 'openai') {
    return {
      url: joinUrl(input.baseUrl ?? OPENAI_BASE_URL, '/v1/chat/completions'),
      headers: { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
      body: {
        model: input.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.imageBase64}` } },
              { type: 'text', text: LABEL_SCAN_INSTRUCTION },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      },
      promptVersion: LABEL_SCAN_PROMPT_VERSION,
    }
  }

  return {
    url: joinUrl(input.baseUrl ?? GEMINI_BASE_URL, `/v1beta/models/${encodeURIComponent(input.model)}:generateContent`),
    headers: { 'x-goog-api-key': credential.value, 'content-type': 'application/json' },
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: input.imageBase64 } },
            { text: LABEL_SCAN_INSTRUCTION },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
    },
    promptVersion: LABEL_SCAN_PROMPT_VERSION,
  }
}
