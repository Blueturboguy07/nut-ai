import { APP_SLUG, APP_VERSION } from './inference/publik-core'
import { PUBLIK_SUPPORT_URL } from './inference/publik-copy'

/**
 * Help and support, and "Report a wrong result" (App Store 1.2: a way to
 * report bad AI content on every AI result).
 *
 * Both open publik's bare in-app support page in the in-app browser sheet.
 * The link carries ONLY the app, its version, where the report came from and
 * the reason the person picked: never a photo, never meal data, never
 * anything from the food log.
 */

export type ReportReason = 'wrong_food' | 'wrong_amount' | 'wrong_numbers' | 'other'
export type SupportSource = 'result' | 'exercise' | 'profile'

/** The short reason picker of "Report a wrong result". */
export const REPORT_REASONS: ReadonlyArray<{ id: ReportReason; label: string }> = [
  { id: 'wrong_food', label: 'Wrong food' },
  { id: 'wrong_amount', label: 'Wrong amount' },
  { id: 'wrong_numbers', label: 'Wrong calories or nutrients' },
  { id: 'other', label: 'Something else' },
]

const SOURCES: readonly SupportSource[] = ['result', 'exercise', 'profile']

export function isSupportSource(v: unknown): v is SupportSource {
  return typeof v === 'string' && (SOURCES as readonly string[]).includes(v)
}

/** publik's support page for this app: app, version, source and reason only. */
export function supportUrl(opts: { reason?: ReportReason; source?: SupportSource } = {}): string {
  const q = [`app=${encodeURIComponent(APP_SLUG)}`, `version=${encodeURIComponent(APP_VERSION)}`]
  if (opts.source) q.push(`source=${opts.source}`)
  if (opts.reason) q.push(`reason=${opts.reason}`)
  return `${PUBLIK_SUPPORT_URL}?${q.join('&')}`
}
