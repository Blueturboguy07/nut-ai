import { Redirect } from 'expo-router'

/**
 * Any link the app has no screen for (for example nutai://home) goes to the
 * start: the sign-in gate and onboarding run first, then Home. Without this
 * file expo-router shows its developer page, "Unmatched Route", whose Sitemap
 * link crashed the app (blind test round 1, Nov 14 2026, B4). No build shows
 * a developer page.
 */
export default function NotFound() {
  return <Redirect href={'/' as never} />
}
