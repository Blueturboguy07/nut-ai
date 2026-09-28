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

export const OWN_KEY_HINT = ' — or use your own key in Profile.'
