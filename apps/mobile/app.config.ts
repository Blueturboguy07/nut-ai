import type { ExpoConfig } from 'expo/config'
import identity from './app-identity.json'

/**
 * App configuration.
 *
 * Every identity string lives in ONE place so the eventual rename is a one-file
 * change rather than a grep across the codebase. `Nut AI` was chosen over the
 * research documents' working codename `Tally`.
 *
 * The app's name is ONE setting: `app-identity.json` → `displayName`
 * ("publik Nut AI": the App Store name and every in-app text, including the
 * permission strings). src/inference/publik-copy.ts reads the same file.
 * `homeScreenName` ("Nut AI") is only the short label under the icon
 * (CFBundleDisplayName, the Android label), because iOS cuts a home-screen
 * label of 13 or more characters. The bundle id, the slug (the publik
 * listing) and the scheme stay as they are on a rename.
 */
const NAME = identity.displayName
const HOME_SCREEN_NAME = identity.homeScreenName

// Every scan sends the photo to an AI provider (publik API or the person's
// own key); there is no on-device model, so the strings say so.
const CAMERA_TEXT = `${NAME} uses your camera to photograph meals and scan barcodes. A meal photo goes to the AI provider you choose, which reads the food.`
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

/**
 * The build number: every App Store upload needs a new one. CI sets
 * APP_BUILD_NUMBER (the run number); a local build is 1.
 */
const BUILD_NUMBER = /^[1-9][0-9]{0,8}$/.test(process.env.APP_BUILD_NUMBER ?? '') ? process.env.APP_BUILD_NUMBER! : '1'

const config: ExpoConfig = {
  // The label under the icon; the App Store and in-app name is NAME.
  name: HOME_SCREEN_NAME,
  slug: SLUG,
  // The publik module's APP_VERSION (src/inference/publik-core.ts) says the
  // same; a test checks it.
  version: '0.1.6',
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
    buildNumber: BUILD_NUMBER,
    // iPhone only (TARGETED_DEVICE_FAMILY = 1): no iPad layout is tested.
    supportsTablet: false,
    /**
     * PrivacyInfo.xcprivacy for the app (Expo does not merge every static
     * CocoaPod's manifest, so the app declares what its code and SDKs use):
     *   UserDefaults CA92.1     React Native and Expo keep app settings in
     *                           this app's own UserDefaults.
     *   FileTimestamp C617.1    expo-file-system and expo-sqlite read the
     *                           dates of files in the app's own container.
     *   SystemBootTime 35F9.1   React Native measures elapsed time.
     *   DiskSpace E174.1        expo-file-system checks free space before
     *                           it writes (photos, backups).
     * Tracking: none (no ad SDK, no ATT). Collected and linked to the
     * publik account (publik keeps telemetry rows with the install and the
     * account): the email address and name of the publik sign-in, the
     * account (UserID), the random install ID and install key (DeviceID), and
     * the app_opened / active_session counts (ProductInteraction). A meal
     * photo sent through publik API: publik keeps no request content, but the
     * AI company behind the model may, so it is declared "not linked" (that
     * company never sees who sent it). The same holds for the text the
     * person types for the AI (a food or a workout described in words):
     * OtherUserContent, not linked, for app functionality. A photo or text
     * sent with the person's own key goes to the AI company they named, not
     * to us or publik. The App Privacy answers in App Store Connect must say
     * the same.
     */
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeName',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality', 'NSPrivacyCollectedDataTypePurposeAnalytics'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality', 'NSPrivacyCollectedDataTypePurposeAnalytics'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeProductInteraction',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosorVideos',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          // Typed food and workout text sent to the AI provider.
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],
    },
    infoPlist: {
      // Required by App Store review, and true: the app talks only to HTTPS
      // APIs (a vendor the user named, or publik API) through the system's
      // networking, which is exempt, and it has no encryption of its own
      // (backups are plain JSON; expo-crypto only makes random IDs).
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: CAMERA_TEXT,
      NSPhotoLibraryUsageDescription: `${NAME} can read a meal photo you already took. The photo goes to the AI provider you choose, which reads the food.`,
      // No NSFaceIDUsageDescription: the app does not use Face ID (expo-secure-store below adds none).
    },
  },

  android: {
    package: BUNDLE_ID,
    versionCode: Number(BUILD_NUMBER),
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B0B0F' },
    permissions: ['android.permission.CAMERA'],
    // No Google Play Services dependency: all notifications are local, there is
    // no push token and no FCM. Preserving that keeps F-Droid viable, which
    // matters for an AGPL project.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },

  plugins: [
    'expo-router',
    // microphonePermission false: the camera takes photos only (no video, no audio), so the app
    // asks for no microphone permission (expo-camera adds a generic one by default).
    ['expo-camera', { cameraPermission: CAMERA_TEXT, microphonePermission: false }],
    // Keys stay out of Android Auto Backup (a restored phone mints a new publik key).
    // faceIDPermission false: no Face ID string, because no key read asks for Face ID.
    ['expo-secure-store', { configureAndroidBackup: true, faceIDPermission: false }],
    'expo-sqlite',
    ...(SKIP_HEALTHKIT
      ? // HealthKit off: the library stays out of the iOS build (ITMS-90683).
        ['./plugins/withoutHealthKitPod']
      : ([
          [
            '@kingstinct/react-native-healthkit',
            {
              // Both strings are required by App Review, and they must describe what we
              // actually do rather than what HealthKit could theoretically allow.
              NSHealthShareUsageDescription:
                `${NAME} reads your steps, workouts and weight so your calorie target reflects what you actually did, instead of a fixed guess.`,
              NSHealthUpdateUsageDescription:
                `${NAME} writes the meals you log to Health so your nutrition data lives alongside the rest of your health record.`,
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
    // A release build with no PUBLIK_APP_TOKEN fails, and so does an App Store
    // build with the test hooks.
    './plugins/withPublikTokenCheck',
  ],

  experiments: { typedRoutes: true },

  extra: {
    // NEVER put an API key here. Keys are written only from runtime user input
    // into expo-secure-store — never from EXPO_PUBLIC_*, app config, .env, or EAS
    // secrets. Anything in `extra` ships in the bundle and is readable by anyone.
    bundleId: BUNDLE_ID,
    // The publik APP token (pat_), from the build input PUBLIK_APP_TOKEN. It is
    // not a key: it names this app to publik so a phone can mint its own key,
    // and every build carries it. expo-constants evaluates this file again at
    // native build time (Xcode phase, Gradle createExpoConfig), so the token of
    // that build's environment is the one in the app. A release build without
    // it fails (plugins/withPublikTokenCheck.js); only a dev build (Metro) may
    // fall back to apps/mobile/publik-build.json (src/inference/publik.ts).
    publikAppToken: process.env.PUBLIK_APP_TOKEN ?? null,
    // Is HealthKit in this build (SKIP_HEALTHKIT=0)? When it is not, the app
    // shows no Apple Health screen, row or onboarding step
    // (src/health/build.ts). Set SKIP_HEALTHKIT=0 for the prebuild AND the
    // native build: this file is evaluated again then.
    healthKit: !SKIP_HEALTHKIT,
  },
}

export default config
