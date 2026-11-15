/**
 * Every sentence the app says about publik API, in one file.
 *
 * Copy rule (publik CONTRACT §1, §12.5): the provider is always "publik API";
 * never tokens, never "credits" as a unit; the vendor is never named in the
 * justification.
 *
 * NO MONEY (founder rule, Nov 14 2026): no sentence in the app says how much
 * money a person spends — no amount, no price per scan, no balance in
 * dollars, no charges page. AI use shows only as a percent of the plan
 * limit (planUseLine), or "Plan active" / "Plan limit reached". A test
 * (src/no-money.test.ts) fails on any user-facing "$" before a digit.
 *
 * Free use (publik migration 0059, 2026-09-28): the one free thing publik
 * API gives is some use, once per publik account, when a phone or computer
 * is first linked to it. Until this phone is linked, a plan or pack is
 * added, or the user pastes their own key, every metered call answers 402,
 * so no sentence here may promise free use before the link.
 */

import identity from '../../app-identity.json'
import type { PlanUse, ProvisionResult } from './publik-core'

/** The app's name ("publik Nut AI"): ONE setting, `apps/mobile/app-identity.json` (app.config.ts reads it too). */
export const APP_NAME: string = identity.displayName

/**
 * Where a purchase link would be, in an App Store build outside the US
 * storefront (publik-core.ts purchaseLinksFor): this one plain sentence, with
 * no link, no button and no price.
 */
export const GET_A_PLAN_ELSEWHERE = 'To get a plan, search for "publik" on Google.'

/** CONTRACT §12.1(b): the one-sentence justification, with no amount of money. */
export function whyItCostsSentence(app = APP_NAME): string {
  return `The AI model behind ${app} is run by a provider that charges per use; your publik plan covers it, and ${app} shows how much of your plan you used.`
}

/** The one free thing (0059), with this app's device noun and no amount. */
export const LINK_STARTER_SENTENCE = 'Linking this phone to your publik account gives some free use, once'

/** The plan line's tail while this phone is not linked. */
export const LINK_STARTER_HINT = 'link this phone for some free use'

/**
 * The install disclosure's sentence about how AI use is paid for (R21
 * §2.1), with no amount of money.
 *
 * `purchaseLinks` false (an App Store build outside the US storefront,
 * publik-core.ts purchaseLinksFor): the same facts with no plan or pack to
 * buy here.
 */
export function disclosureCostSentence(app = APP_NAME, purchaseLinks = true): string {
  const base = `${app} runs on publik API by default: the AI model behind it is run by a provider that charges per use, and your publik plan covers it.`
  const end = `Nothing is charged behind your back, and when your plan limit is reached ${app} tells you and keeps working with your own key.`
  if (!purchaseLinks) return `${base} ${GET_A_PLAN_ELSEWHERE} ${end}`
  const linkStarter = LINK_STARTER_SENTENCE.charAt(0).toLowerCase() + LINK_STARTER_SENTENCE.slice(1)
  return `${base} No card is asked for: ${linkStarter}, and a plan, a pack or your own key takes it from there. ${end}`
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "resets Monday" (within 6 days), "resets today", "resets Nov 24"; null when unknown or past. Local time. */
export function resetPhrase(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) return null
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(at) - day(now)) / 86_400_000)
  if (days === 0) return 'resets today'
  if (days <= 6) return `resets ${WEEKDAYS[at.getDay()]}`
  return `resets ${MONTHS[at.getMonth()]} ${at.getDate()}`
}

/** AI use on a screen: "62% of your plan used · resets Monday", or "Plan active" / "Plan limit reached". Never money. */
export function planUseLine(u: PlanUse, now: Date = new Date()): string {
  const resets = resetPhrase(u.resetsAt, now)
  const tail = resets ? ` · ${resets}` : ''
  if (u.usedPercent != null) return `${u.usedPercent}% of your plan used${tail}`
  if (u.limitReached) return `Plan limit reached${tail}`
  return 'Plan active'
}

/** Where a meal photo goes on publik mode — the second disclosure a phone owes. */
export const DISCLOSURE_DATA_PATH =
  "Your meal photo and the text around it go through publik's servers to the AI provider that answers (for example Anthropic, Google or OpenAI). publik does not store request bodies beyond a 24-hour idempotency fingerprint; the AI provider's own abuse-monitoring retention applies. You can switch to your own key at any time in Profile."

/**
 * The only publik pages the app opens for sign-in, privacy and account
 * deletion: publik's bare in-app pages, with no site navigation, no prices
 * and no plan links. (The claim link: publik-core.ts inAppClaimUrl.)
 */
export const PRIVACY_URL = 'https://publikhq.com/in-app/privacy'
/** publik's account deletion page (Profile → publik account → Delete account). */
export const PUBLIK_DELETE_ACCOUNT_URL = 'https://publikhq.com/in-app/delete-account'
/** publik's support page (Profile → Help and support, Report a wrong result). src/support.ts adds the query. */
export const PUBLIK_SUPPORT_URL = 'https://publikhq.com/in-app/support'

/** CONTRACT §12.1(c) / §12.2: the primary button, by claim state (US storefront only). */
export function linkButtonLabel(claimState: 'anonymous' | 'claimed'): string {
  return claimState === 'anonymous' ? 'Link this phone & pick a plan' : 'Get a plan'
}

/**
 * The plan limit is reached (a 402 or the weekly limit): plain words, when it
 * resets, and the storefront rule — with purchase links (US storefront) the
 * "Get a plan" link below, without them the plain sentence — and the own
 * key. No amount of money.
 */
export function planLimitMessage(resetsAt: string | null, purchaseLinks = true, now: Date = new Date()): string {
  const resets = resetPhrase(resetsAt, now)
  const when = resets ? ` It ${resets}.` : ''
  const next = purchaseLinks ? 'Get a plan at the link below, or use your own key in Profile → AI provider.' : `${GET_A_PLAN_ELSEWHERE} Or use your own key in Profile → AI provider.`
  return `Your publik plan limit is reached.${when} ${next}`
}

export const DISCONNECTED_MESSAGE =
  'publik API is disconnected on this phone. Reconnect it in Profile, or use your own key.'

/**
 * A call that died on this phone's side (timeout, dropped socket) may still
 * have been run by the gateway, which never cancels upstream, so it may
 * still count toward the plan. Every such failure says so, instead of "no
 * connection", which read as "nothing happened" (bug report 19c460c3, Oct 2
 * 2026). No charges page and no amount (founder rule, Nov 14 2026).
 *
 * A call this phone stopped waiting for: the gateway reads upstream to the
 * end after the phone hangs up (blind verify, Nov 2 2026), so the scan most
 * likely counted: the copy says so, and the failure is not retryable (no
 * Retry button).
 */
export function maybeChargedTimeoutMessage(seconds: number): string {
  return `publik API did not answer within ${seconds} seconds. The scan probably still counted toward your plan, so it is not retried. Scan this photo again only if you need the result.`
}

/**
 * fetch rejects the same way for "never left the phone" (airplane mode) and
 * "the socket died mid-call", so the copy names both cases and claims
 * neither: a scan from a phone that was offline did not count.
 */
export const MAYBE_CHARGED_DROPPED_MESSAGE =
  'No answer came back from publik API. Check the connection on this phone. If the phone was online during the scan, it may still count toward your plan.'

/** `finish_reason: "length"`: the model hit its output cap mid-JSON. Counted, unusable. */
export const TRUNCATED_CHARGED_MESSAGE =
  'The answer was cut short before the end, so there is nothing to show. This scan still counts toward your plan. Try a photo with fewer items.'
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
