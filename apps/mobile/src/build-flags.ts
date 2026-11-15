import { Platform } from 'react-native'

/**
 * The build flags, in one place. Metro inlines each `process.env.EXPO_PUBLIC_*`
 * at bundle time, so a flag is fixed in the build; nothing at run time (an
 * intent extra, a URL, a setting) can change it.
 *
 *   EXPO_PUBLIC_APP_STORE_BUILD=1|0   default: on in an iOS release build.
 *     On: links that sell a publik plan or pack show only when the App Store
 *     storefront is the USA (src/inference/publik.ts usePurchaseLinks).
 *     A build with this flag AND the test hooks fails (plugins/
 *     withPublikTokenCheck.js), and the JS turns the hooks off then too.
 *
 *   Claude subscription tokens (the "Claude CLI token" tab): a dev build
 *     (Metro) only. Every other build, Android too, refuses them: Anthropic
 *     does not allow third-party apps to use Claude subscription
 *     credentials. API keys work as before.
 *
 *   EXPO_PUBLIC_PUBLIK_GATE_MODE=required|optional   default: required.
 *     An App Store build is ALWAYS required (the native build fails when it
 *     asks for optional, and this is required then too); optional is a CI
 *     test artifact only.
 *     required: Sign in with publik before any screen of the app.
 *     optional: no wall; sign-in is asked at the AI plan choice (onboarding,
 *     Profile → AI provider) or in Profile → publik account. No usage
 *     counting before sign-in.
 *
 *   EXPO_PUBLIC_PUBLIK_TEST_HOOKS=1   default: off. A CI test build only.
 *     The launch values PUBLIK_API_BASE_URL, PUBLIK_SELF_TEST and the
 *     telemetry test switches are read only when this is on, and the native
 *     side reads them only when it was compiled with PUBLIK_TEST_HOOKS=1.
 */

const isDev = typeof __DEV__ !== 'undefined' && __DEV__

function flag(v: string | undefined): boolean | null {
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return null
}

export const APP_STORE_BUILD: boolean = flag(process.env.EXPO_PUBLIC_APP_STORE_BUILD) ?? (Platform.OS === 'ios' && !isDev)

export type GateMode = 'required' | 'optional'
export const PUBLIK_GATE_MODE: GateMode =
  process.env.EXPO_PUBLIC_PUBLIK_GATE_MODE === 'optional' && !APP_STORE_BUILD ? 'optional' : 'required'

/** Never in an App Store build: the native build fails then, and this is off as well. */
export const PUBLIK_TEST_HOOKS: boolean = process.env.EXPO_PUBLIC_PUBLIK_TEST_HOOKS === '1' && !APP_STORE_BUILD

/** A dev build (Metro, __DEV__). */
export const DEV_BUILD: boolean = isDev

/** The "Claude CLI token" tab and saved Claude subscription tokens: a dev build only. */
export const CLAUDE_SUBSCRIPTION_TOKENS: boolean = isDev

/** A dev build (Metro) may point at a preview gateway; a release build may not, unless it is a test-hooks build. */
export const BUILD_ENV_OVERRIDES: boolean = isDev || PUBLIK_TEST_HOOKS
