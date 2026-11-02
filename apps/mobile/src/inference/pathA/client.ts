import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildExerciseEstimateInstruction,
  buildLabelScanRequest,
  buildOpenAIRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  buildWebLookupRequest,
  computeScanCost,
  EXERCISE_ESTIMATE_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'
import {
  chargeUsdFromHeaders,
  classifyGatewayError,
  isPublikResponse,
  PUBLIK_ORIGIN,
  walletPatchFromHeaders,
  type PublikWalletPatch,
} from '../publik-core'
import {
  MAYBE_CHARGED_DROPPED_MESSAGE,
  TRUNCATED_CHARGED_MESSAGE,
  TRUNCATED_MESSAGE,
  USAGE_ACTION,
  maybeChargedTimeoutMessage,
} from '../publik-copy'

/**
 * Path A — the cloud inference client.
 *
 * SPEC-accuracy-engine.md §3, PLAN.md D10. A thin wrapper over React Native's
 * `fetch`, deliberately NOT the vendor Node SDKs: those assume Node runtime
 * features Hermes does not guarantee. Non-streaming, one request in, one JSON
 * object out — which removes the single largest RN fetch/ReadableStream risk from
 * the core feature.
 *
 * This is the ONLY place in the app that reads an API key, and the key travels to
 * exactly one destination: the provider the user named — or, on publik mode,
 * publik API's gateway (`baseUrl`), which speaks the OpenAI dialect and stamps
 * every answer with `x-publik-*` headers the ledger reads for the real charge.
 */

/**
 * Six distinct states, never a generic toast.
 *
 * Every one of these gets its own copy and its own retry policy, because "an
 * error occurred" tells a user nothing about whether to wait, pay, re-enter a
 * key, or switch paths.
 */
export type ScanFailureKind =
  | 'key-invalid'
  | 'quota-exhausted'
  | 'model-unavailable'
  | 'error-retryable'
  | 'offline'
  | 'content-refusal'
  | 'schema-violation'
  /**
   * The model hit its output cap before the JSON closed (`finish_reason:
   * "length"`). The request WAS billed and the answer is unusable, so it is
   * named — a truncated answer used to fail as "unexpected shape", which
   * told the user nothing about the charge.
   */
  | 'output-truncated'
  /**
   * A request that may or may not have been billed. NEVER auto-retried: no
   * provider offers an idempotency key for this endpoint, so a naive retry
   * double-bills the user for one photo.
   */
  | 'timeout-ambiguous'

export interface ScanFailure {
  kind: ScanFailureKind
  message: string
  retryable: boolean
  httpStatus?: number
  /** publik API's one link (CONTRACT §1: `top_up_url`), origin-checked at classification. */
  action?: { label: string; url: string }
  /** `401 key_revoked { reprovision: true }` — the idle sweep; one bounded re-mint is allowed. */
  reprovision?: boolean
}

export interface ScanSuccess {
  raw: unknown
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  promptVersion: string
  /** The gateway's settled charge (`x-publik-charge-micros`); null off publik. */
  chargeUsd: number | null
  /** The balance after this call, from the response headers; absent off publik. */
  wallet?: PublikWalletPatch
}

export type ScanOutcome = { ok: true; value: ScanSuccess } | { ok: false; error: ScanFailure }

export interface Credential {
  kind: 'api_key' | 'oauth'
  value: string
}

export interface ScanRequest {
  provider: ProviderId
  model: string
  credential: Credential
  imagesBase64: readonly string[]
  localSignalsBlock: string
  jsonSchema: unknown
  timeoutMs?: number
  /** Proxy origin (publik API); absent means the vendor's own host. */
  baseUrl?: string
}

/**
 * How long a meal scan waits. 150 s, not 45: through publik's gateway a
 * reasoning tier took 53-113 s per photo (measured Oct 2 and Nov 1 2026),
 * and the gateway never cancels upstream when the phone hangs up — so every
 * 45 s abort was a full charge with no answer. The gateway's own upstream
 * deadline is 270 s; this stays under it so a timeout here is still the
 * phone's decision, not the server's.
 */
export const SCAN_TIMEOUT_MS = 150_000
/** Label, receipt, lookup: one small JSON object, but the same tiers. */
export const VISION_TIMEOUT_MS = 90_000

/**
 * The output cap was hit. Each dialect names this differently. The call is
 * billed either way, so the answer is still READ: when its JSON is complete
 * (a cap the gateway shrank to fit a low balance can land just after the
 * closing brace) it is used. Only an answer that does not parse is reported
 * as cut short — and a payload that merely parses wrong without a cap is
 * NOT this, and must not be reported as it.
 */
function hitOutputCap(provider: ProviderId, j: Record<string, any>): boolean {
  if (provider === 'anthropic') return j.stop_reason === 'max_tokens'
  if (provider === 'openai') return j.choices?.[0]?.finish_reason === 'length'
  return j.candidates?.[0]?.finishReason === 'MAX_TOKENS'
}

/** postVisionJson sees only the built request; publik mode is the gateway's host. */
function isPublikUrl(url: string): boolean {
  try {
    return new URL(url).origin === PUBLIK_ORIGIN
  } catch {
    return false
  }
}

function truncatedFailure(res: Response): ScanFailure {
  return isPublikResponse(res.headers)
    ? { kind: 'output-truncated', message: TRUNCATED_CHARGED_MESSAGE, retryable: false, action: USAGE_ACTION }
    : { kind: 'output-truncated', message: TRUNCATED_MESSAGE, retryable: false }
}

/** The failure a text-JSON call returns: "cut short" when the cap was hit, else its own. */
function failOrTruncated(capped: boolean, res: Response): (e: ScanFailure) => WebLookupOutcome {
  return (e) => ({ ok: false, error: capped ? truncatedFailure(res) : e })
}

/**
 * The two ways a call dies on this side. On publik mode both say the call
 * may still have been charged and link the usage page: the gateway settles
 * the charge whether or not the phone was still listening.
 */
function transportFailure(err: unknown, publik: boolean, timeoutMs: number, what: string): ScanFailure {
  if ((err as Error)?.name === 'AbortError') {
    return publik
      ? { kind: 'timeout-ambiguous', message: maybeChargedTimeoutMessage(Math.round(timeoutMs / 1000)), retryable: false, action: USAGE_ACTION }
      : { kind: 'timeout-ambiguous', message: `${what} timed out. It may still have been charged, so we will not retry automatically.`, retryable: false }
  }
  return publik
    ? { kind: 'offline', message: MAYBE_CHARGED_DROPPED_MESSAGE, retryable: true, action: USAGE_ACTION }
    : { kind: 'offline', message: 'No connection to the provider.', retryable: true }
}

function classify(status: number, body: string): ScanFailure {
  // A publik envelope names its own state and its one link; it runs before
  // the status switch so a 402 keeps the link and a 401 keeps `reprovision`.
  const gateway = classifyGatewayError(status, body)
  if (gateway) return gateway
  if (status === 401 || status === 403) {
    return { kind: 'key-invalid', message: 'That key was rejected by the provider.', retryable: false, httpStatus: status }
  }
  if (status === 402) {
    return { kind: 'quota-exhausted', message: 'Your provider account is out of credit.', retryable: false, httpStatus: status }
  }
  if (status === 404) {
    return { kind: 'model-unavailable', message: 'That model is not available on your account.', retryable: false, httpStatus: status }
  }
  if (status === 429) {
    return { kind: 'error-retryable', message: 'The provider is rate-limiting. Try again shortly.', retryable: true, httpStatus: status }
  }
  if (status >= 500) {
    return { kind: 'error-retryable', message: 'The provider had a server error.', retryable: true, httpStatus: status }
  }
  if (/refus|safety|policy/i.test(body)) {
    return { kind: 'content-refusal', message: 'The provider declined to analyze this image.', retryable: false, httpStatus: status }
  }
  return { kind: 'error-retryable', message: `Unexpected response (${status}).`, retryable: true, httpStatus: status }
}

/** Pull the JSON payload out of each provider's differently-shaped envelope. */
function extractPayload(provider: ProviderId, json: unknown): { raw: unknown; inputTokens: number; outputTokens: number } | null {
  const j = json as Record<string, any>
  try {
    if (provider === 'anthropic') {
      const text = j.content?.[0]?.text
      return {
        raw: typeof text === 'string' ? JSON.parse(text) : text,
        inputTokens: j.usage?.input_tokens ?? 0,
        outputTokens: j.usage?.output_tokens ?? 0,
      }
    }
    if (provider === 'openai') {
      const text = j.choices?.[0]?.message?.content
      return {
        raw: typeof text === 'string' ? JSON.parse(text) : text,
        inputTokens: j.usage?.prompt_tokens ?? 0,
        outputTokens: j.usage?.completion_tokens ?? 0,
      }
    }
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text
    return {
      raw: typeof text === 'string' ? JSON.parse(text) : text,
      inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0,
    }
  } catch {
    return null
  }
}

/** The metered facts a publik response carries; nothing when it is a vendor response. */
function metered(res: Response): { chargeUsd: number | null; wallet?: PublikWalletPatch } {
  if (!isPublikResponse(res.headers)) return { chargeUsd: null }
  // A PATCH, not a snapshot: this layer has no storage, so it reports only
  // what the headers named and lets the store decide what to keep.
  return { chargeUsd: chargeUsdFromHeaders(res.headers), wallet: walletPatchFromHeaders(res.headers) }
}

export async function runScan(req: ScanRequest, fetchImpl: typeof fetch = fetch): Promise<ScanOutcome> {
  const publik = req.baseUrl != null
  const input = {
    model: req.model,
    imagesBase64: req.imagesBase64,
    localSignalsBlock: req.localSignalsBlock,
    jsonSchema: req.jsonSchema,
    // publik only: its tiers default a reasoning model to "medium" effort,
    // whose thinking counts inside max_tokens and runs the clock. A vendor
    // key sends the bytes it always sent.
    ...(publik ? { baseUrl: req.baseUrl!, reasoningEffort: 'low' as const } : {}),
  }

  const built =
    req.provider === 'anthropic'
      ? buildAnthropicRequest(input, req.credential)
      : req.provider === 'openai'
        ? buildOpenAIRequest(input, req.credential.value)
        : buildGeminiRequest(input, req.credential.value)

  const timeoutMs = req.timeoutMs ?? SCAN_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const res = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false } }
    }

    // A capped answer that does not parse is cut mid-JSON: reporting that as
    // "unexpected shape" hid a billed call. A capped answer that DOES parse
    // is complete and is used.
    const capped = hitOutputCap(req.provider, json as Record<string, any>)
    const extracted = extractPayload(req.provider, json)
    if (!extracted || extracted.raw == null) {
      if (capped) return { ok: false, error: truncatedFailure(res) }
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned an unexpected shape.', retryable: false } }
    }

    const m = metered(res)
    return {
      ok: true,
      value: {
        raw: extracted.raw,
        inputTokens: extracted.inputTokens,
        outputTokens: extracted.outputTokens,
        // Real token counts, never an estimate, so the ledger shows an actual
        // dollar figure rather than a guess. On publik the gateway's settled
        // charge is the figure — it knows cached-token pricing the table does not.
        costUsd: m.chargeUsd ?? computeScanCost(req.provider, req.model, extracted.inputTokens, extracted.outputTokens),
        latencyMs: Date.now() - started,
        promptVersion: built.promptVersion,
        chargeUsd: m.chargeUsd,
        ...(m.wallet ? { wallet: m.wallet } : {}),
      },
    }
  } catch (err) {
    // A timeout MAY have been billed. Never auto-retry — no provider offers
    // an idempotency key here, so a retry can double-charge for one photo. The
    // user is told, and chooses.
    return { ok: false, error: transportFailure(err, publik, timeoutMs, 'The request') }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The scan with a structural safety net.
 *
 * A provider that rejects our schema DIALECT (a structural 400, before auth or
 * billing) should not brick scanning: the same request is retried once with no
 * structured-output mode at all, relying on the prompt plus client-side Zod.
 * That retry costs nothing extra — a structurally rejected request is never
 * billed. Auth failures (401/403) and everything else pass through untouched.
 */
export async function runScanWithFallback(
  req: ScanRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ScanOutcome & { usedSchemaFallback?: boolean }> {
  const first = await runScan(req, fetchImpl)
  const structural =
    !first.ok && first.error.httpStatus === 400 && req.jsonSchema != null
  if (!structural) return first

  const second = await runScan({ ...req, jsonSchema: null }, fetchImpl)
  return second.ok ? { ...second, usedSchemaFallback: true } : first
}

/**
 * Nutrition-label transcription: one image in, one LabelPayload-shaped JSON
 * out. No tools, no structured-output mode; validated by the caller.
 */
export async function runLabelScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string; baseUrl?: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = VISION_TIMEOUT_MS,
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildLabelScanRequest(provider, input, credential), fetchImpl, timeoutMs)
}

/**
 * Free-text exercise estimate — the one exercise path a model owns, labeled
 * as such in the UI. Text in, {label, duration_min, calories_kcal} out.
 */
export async function runExerciseEstimate(
  provider: ProviderId,
  input: { model: string; description: string; weightKg: number | null; baseUrl?: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<WebLookupOutcome> {
  const built = buildTextJsonRequest(
    provider,
    {
      model: input.model,
      instruction: buildExerciseEstimateInstruction(input.description, input.weightKg),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    },
    credential,
    EXERCISE_ESTIMATE_PROMPT_VERSION,
  )
  return postVisionJson(provider, built, fetchImpl, timeoutMs)
}

/** Receipt transcription: same transport, different instruction and validator. */
export async function runReceiptScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string; baseUrl?: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = VISION_TIMEOUT_MS,
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildReceiptScanRequest(provider, input, credential), fetchImpl, timeoutMs)
}

async function postVisionJson(
  provider: ProviderId,
  built: { url: string; headers: Record<string, string>; body: unknown },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<WebLookupOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }
    const m = metered(res)

    let j: Record<string, any>
    try {
      j = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false } }
    }

    // A reasoning tier can spend the whole cap thinking and return NO text
    // at all (seen twice on label scans, Oct 13 2026) — billed either way.
    // A capped answer whose JSON is complete is still used.
    const capped = hitOutputCap(provider, j)
    const fail = failOrTruncated(capped, res)

    let out: string | null = null
    if (provider === 'anthropic') {
      const texts = (j.content ?? []).filter((b: any) => b?.type === 'text')
      out = texts.length ? texts[texts.length - 1].text : null
    } else if (provider === 'openai') {
      out = j.choices?.[0]?.message?.content ?? null
    } else {
      out = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
    }
    if (!out) return fail({ kind: 'schema-violation', message: 'The provider returned no text.', retryable: false })

    const fenced = out.replace(/```(?:json)?/g, '').trim()
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start < 0 || end <= start) return fail({ kind: 'schema-violation', message: 'No JSON in the response.', retryable: false })
    // Capped text that runs on past its last brace was cut inside a later
    // object; the slice would be an inner one, not the answer.
    if (capped && end !== fenced.length - 1) return fail({ kind: 'schema-violation', message: 'No JSON in the response.', retryable: false })
    try {
      return { ok: true, raw: JSON.parse(fenced.slice(start, end + 1)), ...m }
    } catch {
      return fail({ kind: 'schema-violation', message: 'The response JSON did not parse.', retryable: false })
    }
  } catch (err) {
    return { ok: false, error: transportFailure(err, isPublikUrl(built.url), timeoutMs, 'The scan') }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The web-lookup refinement call — the provider's server-side search tool.
 *
 * No structured-output mode here (it does not compose with search on every
 * provider), so the JSON is fished out of prose defensively: last text block,
 * markdown fences stripped, outermost braces isolated. The caller validates
 * with WebLookupResultZ — this function only transports.
 */
export interface WebLookupOutcome {
  ok: boolean
  raw?: unknown
  error?: ScanFailure
  /** The gateway's settled charge for this call; null or absent off publik. */
  chargeUsd?: number | null
  /** The balance after this call; absent off publik. */
  wallet?: PublikWalletPatch
}

export async function runWebLookup(
  provider: ProviderId,
  input: {
    model: string
    itemName: string
    brand: string | null
    visualContext?: string | null
    baseUrl?: string
    /** OpenAI only: false = Chat Completions without the web_search tool (publik mode). */
    webSearch?: boolean
  },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = VISION_TIMEOUT_MS,
): Promise<WebLookupOutcome> {
  const built = buildWebLookupRequest(provider, input, credential)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }
    const m = metered(res)

    let j: Record<string, any>
    try {
      j = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false } }
    }
    const capped = hitOutputCap(provider, j)
    const fail = failOrTruncated(capped, res)

    let out: string | null = null
    if (provider === 'anthropic') {
      // Content is a block ARRAY interleaving tool use and text; the answer is
      // the LAST text block, not the first.
      const texts = (j.content ?? []).filter((b: any) => b?.type === 'text')
      out = texts.length ? texts[texts.length - 1].text : null
    } else if (provider === 'openai') {
      // Responses API: output[] items; the message item holds output_text parts.
      // Chat Completions (the tool-less publik path): choices[0].message.content.
      const msg = (j.output ?? []).find((o: any) => o?.type === 'message')
      out = j.choices?.[0]?.message?.content ?? msg?.content?.map((c: any) => c?.text ?? '').join('') ?? j.output_text ?? null
    } else {
      out = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
    }
    if (!out) return fail({ kind: 'schema-violation', message: 'The provider returned no text.', retryable: false })

    const fenced = out.replace(/```(?:json)?/g, '').trim()
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start < 0 || end <= start) return fail({ kind: 'schema-violation', message: 'No JSON in the response.', retryable: false })
    // Capped text that runs on past its last brace was cut inside a later
    // object; the slice would be an inner one, not the answer.
    if (capped && end !== fenced.length - 1) return fail({ kind: 'schema-violation', message: 'No JSON in the response.', retryable: false })
    try {
      return { ok: true, raw: JSON.parse(fenced.slice(start, end + 1)), ...m }
    } catch {
      return fail({ kind: 'schema-violation', message: 'The response JSON did not parse.', retryable: false })
    }
  } catch (err) {
    return { ok: false, error: transportFailure(err, input.baseUrl != null, timeoutMs, 'The lookup') }
  } finally {
    clearTimeout(timer)
  }
}
