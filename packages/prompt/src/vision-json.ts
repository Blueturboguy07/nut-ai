import { ANTHROPIC_BASE_URL, ANTHROPIC_OAUTH_BETA, GEMINI_BASE_URL, joinUrl, OPENAI_BASE_URL } from './providers.js'
import type { ProviderId, ProviderRequest } from './providers.js'

/**
 * The shared shape behind every "one image in, one JSON object out" call: the
 * label scanner and the receipt scanner. No tools, no structured-output mode —
 * the instruction demands bare JSON and the caller validates with Zod.
 */
export interface VisionJsonInput {
  model: string
  imageBase64: string
  instruction: string
  maxTokens?: number
  /** Proxy origin; absent means the vendor's own host. */
  baseUrl?: string
}

/**
 * Text-only sibling of buildVisionJsonRequest — same transport, no image.
 * Used by the exercise Describe path.
 */
export function buildTextJsonRequest(
  provider: ProviderId,
  input: { model: string; instruction: string; maxTokens?: number; baseUrl?: string },
  credential: { kind: 'api_key' | 'oauth'; value: string },
  promptVersion: string,
): ProviderRequest {
  const maxTokens = input.maxTokens ?? 512

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
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: input.instruction }],
      },
      promptVersion,
    }
  }

  if (provider === 'openai') {
    return {
      url: joinUrl(input.baseUrl ?? OPENAI_BASE_URL, '/v1/chat/completions'),
      headers: { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
      body: {
        model: input.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: input.instruction }],
        response_format: { type: 'json_object' },
      },
      promptVersion,
    }
  }

  return {
    url: joinUrl(input.baseUrl ?? GEMINI_BASE_URL, `/v1beta/models/${encodeURIComponent(input.model)}:generateContent`),
    headers: { 'x-goog-api-key': credential.value, 'content-type': 'application/json' },
    body: {
      contents: [{ role: 'user', parts: [{ text: input.instruction }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    },
    promptVersion,
  }
}

export const EXERCISE_ESTIMATE_PROMPT_VERSION = 'exercise-estimate-v1'

export function buildExerciseEstimateInstruction(description: string, weightKg: number | null): string {
  return [
    `Estimate the calories burned by this workout, described by the user: "${description.trim()}"`,
    weightKg ? `The user weighs about ${Math.round(weightKg)} kg.` : 'Body weight unknown — assume 80 kg.',
    '',
    'Rules:',
    '- Use standard MET values for the activity and intensity described. Be conservative: when the description is ambiguous, choose the LOWER plausible figure. People overestimate exercise burn, and an inflated number here corrupts their daily budget.',
    '- duration_min from the description; null if none was given (and reflect that uncertainty by staying conservative).',
    '- label: a short title for the log, e.g. "Leg strength training".',
    '',
    'Respond with ONLY this JSON object:',
    '{"label": string, "duration_min": number|null, "calories_kcal": number}',
  ].join('\n')
}

export function buildVisionJsonRequest(
  provider: ProviderId,
  input: VisionJsonInput,
  credential: { kind: 'api_key' | 'oauth'; value: string },
  promptVersion: string,
): ProviderRequest {
  const maxTokens = input.maxTokens ?? 1024

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
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 } },
              { type: 'text', text: input.instruction },
            ],
          },
        ],
      },
      promptVersion,
    }
  }

  if (provider === 'openai') {
    return {
      url: joinUrl(input.baseUrl ?? OPENAI_BASE_URL, '/v1/chat/completions'),
      headers: { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
      body: {
        model: input.model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.imageBase64}` } },
              { type: 'text', text: input.instruction },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      },
      promptVersion,
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
            { text: input.instruction },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    },
    promptVersion,
  }
}
