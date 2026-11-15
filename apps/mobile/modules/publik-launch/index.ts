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
 * compiled with PUBLIK_TEST_HOOKS=1. An App Store build never has the hooks
 * (build-flags.ts, plugins/withPublikTokenCheck.js).
 *
 * In EVERY build the module also reads the App Store storefront country
 * (StoreKit, iOS): links that sell a publik plan show in an App Store build
 * only in the US storefront (src/inference/publik.ts usePurchaseLinks). In a test build the values come from
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
  /** iOS: StoreKit's storefront country (ISO 3166-1 alpha-3, "USA"), or null (always null on a simulator). Android: "". */
  storefrontCountry?(): Promise<string | null> | string | null
  /** iOS: true on a simulator. Android: false. */
  isSimulator?(): boolean
  /** One line in the system log (NSLog, logcat), in every build. */
  logLine?(line: string): void
}

// Loaded in every build for the storefront; the launch values stay test-build only (guards below).
const native = requireOptionalNativeModule<PublikLaunchNative>('PublikLaunch')

const STOREFRONT_TIMEOUT_MS = 5_000

/**
 * The App Store storefront country of this phone ("USA"), or null when it
 * cannot be read (no module, Android, no answer within 5 s): then an App
 * Store build shows no purchase link.
 */
export async function storefrontCountry(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const read = Promise.resolve(native?.storefrontCountry?.() ?? null)
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), STOREFRONT_TIMEOUT_MS)
    })
    const v = await Promise.race([read, late])
    return typeof v === 'string' && /^[A-Za-z]{2,3}$/.test(v.trim()) ? v.trim().toUpperCase() : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * true on an iOS simulator, false on a real phone (and on Android), null when
 * it cannot be read (no module: Expo Go, unit tests). The purchase rule treats
 * a simulator as "storefront unknown" (publik-core.ts storefrontReading).
 */
export function isSimulator(): boolean | null {
  try {
    const v = native?.isSimulator?.()
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

/** One line in the system log, in every build (a release build drops console.log). Never a secret. */
export function logLine(line: string): void {
  try {
    native?.logLine?.(line)
  } catch {
    /* the console line below still says it */
  }
  console.log(line)
}

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
