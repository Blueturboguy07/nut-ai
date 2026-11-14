import { requireOptionalNativeModule } from 'expo'
import { PUBLIK_TEST_HOOKS } from '../../src/build-flags'

/**
 * The launch switches of the publik module (src/inference/publik-core.ts):
 * PUBLIK_SELF_TEST, PUBLIK_API_BASE_URL (the test hook), DO_NOT_TRACK,
 * PUBLIK_TELEMETRY, PUBLIK_TELEMETRY_DEBUG, PUBLIK_TELEMETRY_INTERVAL_SECONDS.
 *
 * A CI TEST BUILD ONLY. Both halves are compiled out of a release build: this
 * file reads nothing unless EXPO_PUBLIC_PUBLIK_TEST_HOOKS=1 was set at bundle
 * time, and the native side (ios/, android/) reads nothing unless it was
 * compiled with PUBLIK_TEST_HOOKS=1. In a test build the values come from
 * the launch: an environment variable or a launch argument on iOS (only
 * Xcode, `xcrun simctl` or a debugger can set one), an intent extra on
 * Android (`adb shell am start -e`). No URL scheme, web content or saved
 * setting reaches them. The module is missing in Expo Go and in unit tests:
 * then every value is null and the self-test line goes to the log.
 */
interface PublikLaunchNative {
  value(name: string): string | null
  printLine(line: string): void
  exit(): void
}

const native = PUBLIK_TEST_HOOKS ? requireOptionalNativeModule<PublikLaunchNative>('PublikLaunch') : null

export function launchValue(name: string): string | null {
  if (!PUBLIK_TEST_HOOKS) return null
  try {
    const v = native?.value(name)
    return typeof v === 'string' && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

/** The self-test: one line on stdout, then the app exits (test builds only). */
export function printLineAndExit(line: string): void {
  if (!PUBLIK_TEST_HOOKS) return
  try {
    native?.printLine(line)
  } catch {
    /* the log line below still says it */
  }
  console.log(line)
  try {
    native?.exit()
  } catch {
    /* no native module: the app keeps running */
  }
}
