import type { ProviderId } from '@nutai/prompt'
import { consentGiven, recordConsent } from '../data/repo'

/**
 * Consent before anything goes to an AI provider (App Store 5.1.2(i): name
 * the third-party AI and get explicit permission first).
 *
 * One consent per destination: publik, Anthropic, OpenAI, Google. The
 * resolver (resolve.ts) asks for it before EVERY AI call, so a meal photo, a
 * food description or an earlier photo sent again never goes to a provider
 * the person did not agree to. The first time, the app shows the question
 * (app/_layout.tsx registers the prompter); "Not now" sends nothing.
 */

export type AiDestination = ProviderId | 'publik'

export const AI_CONSENT_VERSION = '1'
const keyOf = (d: AiDestination) => `ai.share.${d}`

const NAME: Record<AiDestination, string> = { publik: 'publik', anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' }

/**
 * App Store 5.1.2(i): name the companies that get the data. publik's API
 * (GET /api/v1/wallet, the SDK docs) does not list its model providers, so
 * the publik path names them by example.
 */
export const PUBLIK_AI_PROVIDERS_SENTENCE =
  'publik sends them to the AI provider that answers (for example Anthropic, Google or OpenAI).'

/** The question, naming where the data goes. */
export function aiConsentCopy(d: AiDestination, appName: string): { title: string; body: string; agree: string; decline: string } {
  const name = NAME[d]
  const where =
    d === 'publik'
      ? `publik (publikhq.com). ${PUBLIK_AI_PROVIDERS_SENTENCE}`
      : `${name}, with your own key`
  return {
    title: `Send meal photos to ${name}?`,
    body: `To estimate calories, ${appName} sends your meal photos and the food and workout descriptions you type to ${where}. Your food log stays on this phone. Nothing goes to ${name} until you agree. You can change the AI provider in Profile → AI provider.`,
    agree: 'I agree',
    decline: 'Not now',
  }
}

type Prompter = (d: AiDestination) => Promise<boolean>
let prompter: Prompter | null = null
const pending = new Map<AiDestination, Promise<boolean>>()

export function setAiConsentPrompter(p: Prompter | null): void {
  prompter = p
}

export async function hasAiConsent(d: AiDestination): Promise<boolean> {
  try {
    return await consentGiven(keyOf(d))
  } catch {
    return false
  }
}

export async function recordAiConsent(d: AiDestination): Promise<void> {
  await recordConsent(keyOf(d), AI_CONSENT_VERSION)
}

/** True when the person agreed (now or before). One question at a time per destination. */
export function ensureAiConsent(d: AiDestination): Promise<boolean> {
  const open = pending.get(d)
  if (open) return open
  const run = (async () => {
    if (await hasAiConsent(d)) return true
    if (!prompter) return false
    const yes = await prompter(d).catch(() => false)
    if (yes) await recordAiConsent(d).catch(() => undefined)
    return yes
  })().finally(() => pending.delete(d))
  pending.set(d, run)
  return run
}
