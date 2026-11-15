/**
 * React Native autolinking settings for apps/mobile.
 *
 * HealthKit is OFF unless SKIP_HEALTHKIT=0 (app.config.ts). When it is off, the
 * HealthKit library is not linked into the iOS app either: an app that links
 * HealthKit without the HealthKit entitlement and without the Health purpose
 * strings is refused by App Store Connect (ITMS-90683), and its "Connect to
 * Apple Health" step could never work. src/health/healthkit.ts already treats a
 * missing pod as "unavailable" (dynamic import in try/catch).
 *
 * SKIP_HEALTHKIT=0 npm run prebuild links it again, together with the
 * entitlement and the purpose strings from the config plugin.
 */
const SKIP_HEALTHKIT = process.env.SKIP_HEALTHKIT !== '0'

module.exports = {
  dependencies: SKIP_HEALTHKIT
    ? { '@kingstinct/react-native-healthkit': { platforms: { ios: null } } }
    : {},
}
