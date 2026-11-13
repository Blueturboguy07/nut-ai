import { requireOptionalNativeModule } from 'expo'

/**
 * The launch switches of the publik module (src/inference/publik-core.ts):
 * PUBLIK_SELF_TEST, PUBLIK_API_BASE_URL (the test hook), DO_NOT_TRACK,
 * PUBLIK_TELEMETRY, PUBLIK_TELEMETRY_DEBUG, PUBLIK_TELEMETRY_INTERVAL_SECONDS.
 *
 * A phone app has no shell environment of its own, and Metro inlines
 * `process.env` at bundle time, so these come from the native side
 * (ios/, android/): an environment variable or a launch argument on iOS
 * (only Xcode, `xcrun simctl` or a debugger can set one), an intent extra on
 * Android (`adb shell am start -e`), read only in a debuggable build because
 * any app can put extras on an intent. The module is missing in Expo Go and in
 * unit tests: then every value is null and the self-test line goes to the log.
 */
interface PublikLaunchNative {
  value(name: string): string | null
  printLine(line: string): void
  exit(): void
}

const native = requireOptionalNativeModule<PublikLaunchNative>('PublikLaunch')

export function launchValue(name: string): string | null {
  try {
    const v = native?.value(name)
    return typeof v === 'string' && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

/** The self-test: one line on stdout, then the app exits. */
export function printLineAndExit(line: string): void {
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
