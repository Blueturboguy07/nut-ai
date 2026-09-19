import { buildVisionJsonRequest } from './vision-json.js'
import type { ProviderId, ProviderRequest } from './providers.js'

/**
 * Receipt transcription — the meal you didn't photograph.
 *
 * The model's ONLY job is reading the paper: merchant and food line items.
 * Nutrition comes afterwards from the web-lookup machinery, one search per
 * item with the merchant as the brand, so every number traces to published
 * facts rather than to what a model thinks a "LG FRY" weighs.
 */

export const RECEIPT_SCAN_PROMPT_VERSION = 'receipt-scan-v1'

export const RECEIPT_SCAN_INSTRUCTION = [
  'The photo shows a purchase receipt. TRANSCRIBE the food and drink line items — copy what is printed, expanding obvious receipt abbreviations ("MCCHICKEN" -> "McChicken", "LG FRY" -> "Large Fries") but never guessing beyond the print.',
  '',
  'Rules:',
  '- merchant: the restaurant or store name from the receipt header, or null.',
  '- items: FOOD AND DRINK ONLY. Skip tax, totals, discounts, delivery fees, utensils, bags and non-food merchandise.',
  '- quantity from the printed qty column; 1 when none is printed.',
  '- Combine identical lines by summing quantity.',
  '- A combo/meal line expands to its standard parts when the receipt itself does not itemize them: "Big Mac Meal" -> Big Mac, Medium Fries, Medium Drink.',
  '- If the photo is not a legible receipt, return {"merchant": null, "items": []}.',
  '',
  'Respond with ONLY this JSON object:',
  '{"merchant": string|null, "items": [{"name": string, "quantity": number}]}',
].join('\n')

export function buildReceiptScanRequest(
  provider: ProviderId,
  input: { model: string; imageBase64: string; baseUrl?: string },
  credential: { kind: 'api_key' | 'oauth'; value: string },
): ProviderRequest {
  return buildVisionJsonRequest(
    provider,
    { ...input, instruction: RECEIPT_SCAN_INSTRUCTION, maxTokens: 1024 },
    credential,
    RECEIPT_SCAN_PROMPT_VERSION,
  )
}
