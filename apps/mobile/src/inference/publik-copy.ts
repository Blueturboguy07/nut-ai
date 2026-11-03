/**
 * Every sentence the app says about publik API, in one file.
 *
 * Copy rule (publik CONTRACT §1, §12.5): the provider is always "publik API";
 * money is dollars — never tokens, never "credits" as a unit; the vendor is
 * never named in the justification. The two justification sentences are
 * copied VERBATIM from publikhq.com's `lib/publik-api/why-it-costs.ts` so the
 * argument a user reads in the app is the argument they read on the site.
 *
 * Free use (publik migration 0059, 2026-09-28): a new install starts at
 * $0.00. The one free thing publik API gives is $0.05 of use, once per publik
 * account, when a phone or computer is first linked to it. Until this phone
 * is linked, a plan or pack is added, or the user pastes their own key, every
 * metered call answers 402, so no sentence here may promise free use before
 * the link.
 */

import type { ProvisionResult } from './publik-core'

export const APP_NAME = 'Nut AI'

/** CONTRACT §12.1(b): the one-sentence justification, verbatim from the site. */
export function whyItCostsSentence(app = APP_NAME): string {
  return `The AI model behind ${app} is run by a provider that charges per use; publik passes that on at half the provider's list price, nothing is charged behind your back, and you can see every call on your dashboard.`
}

/** The one free thing, as the site says it (0059), with this app's device noun. */
export const LINK_STARTER_SENTENCE = 'Linking this phone to your publik account gives $0.05 of free use, once'

/** The balance line's tail while this phone is unlinked at $0.00. */
export const LINK_STARTER_HINT = 'link this phone for $0.05 of free use'

/**
 * The install disclosure's cost sentence (R21 §2.1). The free-use clause
 * follows the site's since 0059: a new phone starts at $0.00, and linking it
 * is what gives $0.05 of free use, once.
 */
export function disclosureCostSentence(app = APP_NAME): string {
  const linkStarter = LINK_STARTER_SENTENCE.charAt(0).toLowerCase() + LINK_STARTER_SENTENCE.slice(1)
  return `${app} runs on publik API by default: the AI model behind it is run by a provider that charges per use, and publik passes that on at 50% of the model's published list price with no markup, from your publik balance. A new phone starts at $0.00 and no card is asked for: ${linkStarter}, and a plan, a pack or your own key takes it from there; nothing is charged behind your back, and when the balance runs out ${app} tells you and keeps working with your own key — most people spend under $2 a month.`
}

/** Where a meal photo goes on publik mode — the second disclosure a phone owes. */
export const DISCLOSURE_DATA_PATH =
  "Your meal photo and the text around it go through publik's servers to a shared model account. publik does not store request bodies beyond a 24-hour idempotency fingerprint; the model provider's own abuse-monitoring retention applies. You can switch to your own key at any time in Profile."

export const TERMS_URL = 'https://publikhq.com/terms#api'

/** CONTRACT §12.1(c) / §12.2: the primary button, by claim state. */
export function linkButtonLabel(claimState: 'anonymous' | 'claimed'): string {
  return claimState === 'anonymous' ? 'Link this phone & pick a plan' : 'Add a plan or pack'
}

/** The 402 fallback when the gateway's own message is missing. */
export function insufficientCreditMessage(claimState: 'anonymous' | 'claimed'): string {
  const next =
    claimState === 'anonymous'
      ? 'Link this phone to your publik account at the link below for $0.05 of free use, pick a plan there, or use your own key.'
      : 'Add a plan or a pack at the link below, or use your own key.'
  return `Your publik balance is too low for this request. The model behind this app is billed per use by its provider; publik passes that on at half the list price and nothing is charged behind your back. ${next}`
}

export const DISCONNECTED_MESSAGE =
  'publik API is disconnected on this phone. Reconnect it in Profile, or use your own key.'

/**
 * A call that died on this phone's side (timeout, dropped socket) may still
 * have been run — and billed — by the gateway, which never cancels upstream.
 * Every such failure says so and links the page that shows the charge,
 * instead of "no connection", which read as "nothing happened" to a user
 * whose balance had just dropped (bug report 19c460c3, Oct 2 2026).
 */
export const USAGE_URL = 'https://publikhq.com/wallet'
export const USAGE_ACTION = { label: 'See charges on publik', url: USAGE_URL }

/**
 * A call this phone stopped waiting for. The gateway reads upstream to the
 * end after the phone hangs up and settles the charge (a 45 s abort on the
 * old pin was charged $0.058, blind verify Nov 2 2026), so the call was most
 * likely charged: the copy says so, sends the user to the charges first, and
 * the failure is not retryable (no Retry button).
 */
export function maybeChargedTimeoutMessage(seconds: number): string {
  return `publik API did not answer within ${seconds} seconds. The call was probably still charged, so it is not retried. Check your charges before you scan this photo again.`
}

/**
 * fetch rejects the same way for "never left the phone" (airplane mode) and
 * "the socket died mid-call", so the copy names both cases and claims
 * neither: a phone that was offline was not charged.
 */
export const MAYBE_CHARGED_DROPPED_MESSAGE =
  'No answer came back from publik API. Check the connection on this phone. If the phone was online during the scan, publik may still have charged the call.'

/** `finish_reason: "length"`: the model hit its output cap mid-JSON. Billed, unusable. */
export const TRUNCATED_CHARGED_MESSAGE =
  'The answer was cut short before the end, so there is nothing to show. This call was charged. Try a photo with fewer items.'
export const TRUNCATED_MESSAGE =
  'The answer was cut short before the end, so there is nothing to show. Try a photo with fewer items.'

export const OWN_KEY_HINT = ' — or use your own key in Profile.'

/** "about 37 minutes" from a Retry-After in seconds; never less than a minute. */
export function waitPhrase(retryAfterSec: number | undefined): string {
  const minutes = Math.max(1, Math.ceil((retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 60) / 60))
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`
}

/**
 * Why connecting publik API failed — onboarding, Profile, and the one re-mint
 * after `key_revoked`. The 429 is publikhq.com's per-network limit on new
 * connections (5 an hour); its Retry-After can be most of an hour, so the
 * copy says how long, not "a minute".
 */
export function provisionFailureMessage(r: Extract<ProvisionResult, { ok: false }>): string {
  switch (r.kind) {
    case 'offline':
      return 'No connection. Nothing was set up — try again when you are back online, or use your own key.'
    case 'rate-limited':
      return `Too many phones on this network connected to publik API in the last hour. Try again in ${waitPhrase(r.retryAfterSec)}, or use your own key.`
    case 'replayed':
    case 'malformed':
      return `publik API answered in a shape this build does not understand. Update ${APP_NAME}, or use your own key.`
    default:
      // 'unavailable', or this build's app id was revoked on publikhq.com.
      // (Named by default: the copy rule test bans that kind's name here.)
      return 'publik API is not available for this build right now. Use your own key for now — you can switch later in Profile.'
  }
}
