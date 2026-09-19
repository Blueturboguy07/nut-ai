import type { ExpoConfig } from 'expo/config'

/**
 * App configuration.
 *
 * Every identity string lives in ONE place so the eventual rename is a one-file
 * change rather than a grep across the codebase. `Nut AI` was chosen over the
 * research documents' working codename `Tally`.
 */
const NAME = 'Nut AI'
const SLUG = 'nut-ai'
const BUNDLE_ID = 'com.nutai.app'
const SCHEME = 'nutai'

/**
 * Apple will not issue a HealthKit-capable provisioning profile to a free
 * personal-team Apple ID — full stop, no signing setting routes around it.
 * ("Trying to Sign the app but it doesn't work" reproduced: with a free team
 * selected and Automatic signing on, the real Xcode error is "Provisioning
 * profile ... doesn't include the HealthKit capability / entitlement" — a
 * platform restriction, not a bug in this project's signing config.) HealthKit
 * is additive (README: "Health reconnect"), and src/health/healthkit.ts is
 * already written to degrade gracefully when it is unavailable.
 *
 * The README's own documented "Put it on your phone" path is `npm run
 * prebuild` with no env vars at all, signed with "your free Apple ID" — that
 * is the default builder this repo ships for, not an edge case someone has
 * to already know to route around. Defaulting to *include* HealthKit meant
 * the documented, default path failed automatic signing outright (bug
 * reports: "Signing ... requires a development team" /
 * "Failed Registering Bundle Identifier"; Apple's registration error here is
 * generic and does not itself name HealthKit as the cause). So HealthKit now
 * defaults to OFF; a builder who has confirmed their team is a paid Apple
 * Developer Program membership (the only tier Apple grants HealthKit to)
 * opts back in with:
 *
 *   SKIP_HEALTHKIT=0 npm run prebuild
 *
 * SKIP_HEALTHKIT=1 keeps working — now a no-op — for anyone who already has
 * it in a script or a bookmark from before this default flipped.
 */
const SKIP_HEALTHKIT = process.env.SKIP_HEALTHKIT !== '0'

const config: ExpoConfig = {
  name: NAME,
  slug: SLUG,
  version: '0.1.0',
  // The mark: a white peanut silhouette inside four scan-frame corners on
  // near-black. Source of truth is assets/icon.svg; the PNGs are rendered
  // from it (rsvg-convert), never hand-edited.
  icon: './assets/icon.png',
  orientation: 'portrait',
  // Deep links carry widget taps and notification actions straight to a screen.
  scheme: SCHEME,
  userInterfaceStyle: 'automatic',
  // No `newArchEnabled` flag: the New Architecture is the default in SDK 57 and
  // the option was removed from ExpoConfig entirely. Setting it is now a
  // typecheck error, which is how this was caught.

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      // Required by App Store review, and true: there is no server we operate,
      // so there is no non-exempt encryption to declare.
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        'Nut AI uses your camera to photograph meals and scan barcodes. Photos stay on your device unless you choose a cloud provider during setup.',
      NSPhotoLibraryUsageDescription:
        'Nut AI can read a meal photo you already took. Photos stay on your device unless you choose a cloud provider during setup.',
      NSFaceIDUsageDescription:
        'Nut AI uses Face ID only when you reveal or edit a stored API key — never to log a meal.',
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B0B0F' },
    permissions: ['android.permission.CAMERA'],
    // No Google Play Services dependency: all notifications are local, there is
    // no push token and no FCM. Preserving that keeps F-Droid viable, which
    // matters for an AGPL project.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },

  plugins: [
    'expo-router',
    ['expo-camera', { cameraPermission: 'Nut AI uses your camera to photograph meals and scan barcodes.' }],
    'expo-secure-store',
    'expo-sqlite',
    ...(SKIP_HEALTHKIT
      ? []
      : ([
          [
            '@kingstinct/react-native-healthkit',
            {
              // Both strings are required by App Review, and they must describe what we
              // actually do rather than what HealthKit could theoretically allow.
              NSHealthShareUsageDescription:
                'Nut AI reads your steps, workouts and weight so your calorie target reflects what you actually did, instead of a fixed guess.',
              NSHealthUpdateUsageDescription:
                'Nut AI writes the meals you log to Health so your nutrition data lives alongside the rest of your health record.',
              // Background delivery is deliberately off. It is an extra entitlement, it
              // is a battery cost, and nothing here needs to react to a step count
              // while the app is closed.
              background: false,
            },
          ],
        ] as [string, Record<string, unknown>][])),
    // Every builder signs with their own free Apple ID — see the plugin doc
    // comment for why this can only ever set the MODE (automatic), never a team.
    './plugins/withAutomaticSigning',
  ],

  experiments: { typedRoutes: true },

  extra: {
    // NEVER put an API key here. Keys are written only from runtime user input
    // into expo-secure-store — never from EXPO_PUBLIC_*, app config, .env, or EAS
    // secrets. Anything in `extra` ships in the bundle and is readable by anyone.
    bundleId: BUNDLE_ID,
  },
}

export default config
