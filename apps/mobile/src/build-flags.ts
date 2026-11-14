import { Platform } from 'react-native'

/**
 * The build flags, in one place. Metro inlines each `process.env.EXPO_PUBLIC_*`
 * at bundle time, so a flag is fixed in the build; nothing at run time (an
 * intent extra, a URL, a setting) can change it.
 *
 *   EXPO_PUBLIC_APP_STORE_BUILD=1|0   default: on in an iOS release build.
 *     On: no "Claude CLI token" path (Anthropic does not allow third-party
 *     apps to use Claude subscription credentials); API keys work as before.
 *
 *   EXPO_PUBLIC_PUBLIK_GATE_MODE=required|optional   default: required.
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
export const PUBLIK_GATE_MODE: GateMode = process.env.EXPO_PUBLIC_PUBLIK_GATE_MODE === 'optional' ? 'optional' : 'required'

export const PUBLIK_TEST_HOOKS: boolean = process.env.EXPO_PUBLIC_PUBLIK_TEST_HOOKS === '1'

/** A dev build (Metro) may point at a preview gateway; a release build may not, unless it is a test-hooks build. */
export const BUILD_ENV_OVERRIDES: boolean = isDev || PUBLIK_TEST_HOOKS
