const { withPodfile } = require('@expo/config-plugins')

/**
 * HealthKit is OFF unless the build runs with SKIP_HEALTHKIT=0 (app.config.ts).
 * When it is off, the HealthKit library must not be in the iOS app at all:
 * App Store Connect refuses a binary that links HealthKit without the two
 * Health purpose strings (ITMS-90683), and a build without HealthKit has no
 * Health feature to describe.
 *
 * Expo autolinking ignores `platforms: { ios: null }` in react-native.config.js
 * for this library (the library declares its own iOS config, and the merge
 * keeps it). So this plugin gives the autolinking command in the Podfile
 * `--exclude @kingstinct/react-native-healthkit` instead. app.config.ts adds
 * the plugin only when HealthKit is off.
 */
const PACKAGE = '@kingstinct/react-native-healthkit'
const ANCHOR = "'react-native-config',"

module.exports = function withoutHealthKitPod(config) {
  return withPodfile(config, (cfg) => {
    const podfile = cfg.modResults.contents
    if (podfile.includes(`'--exclude', '${PACKAGE}'`)) return cfg
    if (!podfile.includes(ANCHOR)) {
      throw new Error(`withoutHealthKitPod: the Podfile has no ${ANCHOR} line, so HealthKit cannot be left out.`)
    }
    cfg.modResults.contents = podfile.replace(ANCHOR, `${ANCHOR} '--exclude', '${PACKAGE}',`)
    return cfg
  })
}
