const { withAppBuildGradle, withXcodeProject } = require('@expo/config-plugins')

/**
 * Three build rules of the publik gate, checked by the native build itself:
 *
 * 1. A RELEASE build takes the publik app token ONLY from the build input
 *    PUBLIK_APP_TOKEN (an environment variable of the build; CI passes the
 *    repo secret). app.config.ts puts it into `extra.publikAppToken`, which
 *    expo-constants writes into the app at build time. A release build with
 *    no such token (or the placeholder) fails, because its Sign in with
 *    publik could never work. The committed apps/mobile/publik-build.json
 *    serves a dev build (Metro) only.
 *
 * 2. An App Store build never carries the test hooks: a build with
 *    EXPO_PUBLIC_APP_STORE_BUILD on (the default of an iOS Release build) AND
 *    PUBLIK_TEST_HOOKS=1 or EXPO_PUBLIC_PUBLIK_TEST_HOOKS=1 fails, on iOS and
 *    Android. CI test builds set EXPO_PUBLIC_APP_STORE_BUILD=0.
 *
 * 3. An App Store build always has the required gate: a build with
 *    EXPO_PUBLIC_APP_STORE_BUILD on AND EXPO_PUBLIC_PUBLIK_GATE_MODE=optional
 *    fails (the optional variant is a CI test artifact only).
 *
 *   iOS: a "Check publik build settings" build phase on the app target.
 *        Rule 1 for the Release configuration; rules 2 and 3 for every
 *        configuration.
 *   Android: rules 2 and 3 before every variant (preBuild); rule 1 before
 *        every release variant (preReleaseBuild).
 *
 * The checks read the token only for its form; they never print it.
 */

const PHASE_NAME = 'Check publik build settings'
const SCRIPT = [
  'HOOKS=0; if [ "$PUBLIK_TEST_HOOKS" = "1" ] || [ "$EXPO_PUBLIC_PUBLIK_TEST_HOOKS" = "1" ]; then HOOKS=1; fi;',
  'case "$EXPO_PUBLIC_APP_STORE_BUILD" in 1|true) STORE=1;; 0|false) STORE=0;; *) if [ "$CONFIGURATION" = "Release" ]; then STORE=1; else STORE=0; fi;; esac;',
  'if [ "$HOOKS" = "1" ] && [ "$STORE" = "1" ]; then',
  'echo "error: publik: an App Store build (EXPO_PUBLIC_APP_STORE_BUILD) must not have the test hooks (PUBLIK_TEST_HOOKS). Set EXPO_PUBLIC_APP_STORE_BUILD=0 for a test build."; exit 1;',
  'fi;',
  'if [ "$STORE" = "1" ] && [ "$EXPO_PUBLIC_PUBLIK_GATE_MODE" = "optional" ]; then',
  'echo "error: publik: an App Store build (EXPO_PUBLIC_APP_STORE_BUILD) always has the required gate; EXPO_PUBLIC_PUBLIK_GATE_MODE=optional is for a test build."; exit 1;',
  'fi;',
  'if [ "$CONFIGURATION" = "Release" ]; then',
  'T="$PUBLIK_APP_TOKEN"; OK=1;',
  'case "$T" in pat_????????*) ;; *) OK=0;; esac;',
  'case "$T" in *[!A-Za-z0-9_-]*|*REPLACE_ME*) OK=0;; esac;',
  'if [ "${#T}" -gt 204 ]; then OK=0; fi;',
  'if [ "$OK" != "1" ]; then',
  'echo "error: publik: this Release build has no publik app token. Set PUBLIK_APP_TOKEN (pat_) in the build environment."; exit 1;',
  'fi; fi',
].join(' ')

function withIosCheck(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    const target = project.getFirstTarget()
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {}
    const exists = Object.values(phases).some((p) => p && typeof p === 'object' && String(p.name || '').includes(PHASE_NAME))
    if (target && !exists) {
      project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, target.uuid, {
        shellPath: '/bin/sh',
        shellScript: SCRIPT,
        // The phase reads only the build environment, no file.
        inputPaths: [],
        outputPaths: [],
      })
    }
    return cfg
  })
}

const GROOVY = `
// publik: build rules (plugins/withPublikTokenCheck.js).
tasks.matching { it.name == 'preBuild' }.configureEach {
    doFirst {
        def publikHooks = System.getenv('PUBLIK_TEST_HOOKS') == '1' || System.getenv('EXPO_PUBLIC_PUBLIK_TEST_HOOKS') == '1'
        def publikStore = ['1', 'true'].contains(System.getenv('EXPO_PUBLIC_APP_STORE_BUILD') ?: '')
        if (publikHooks && publikStore) {
            throw new GradleException('publik: an App Store build (EXPO_PUBLIC_APP_STORE_BUILD) must not have the test hooks (PUBLIK_TEST_HOOKS).')
        }
        if (publikStore && System.getenv('EXPO_PUBLIC_PUBLIK_GATE_MODE') == 'optional') {
            throw new GradleException('publik: an App Store build (EXPO_PUBLIC_APP_STORE_BUILD) always has the required gate; EXPO_PUBLIC_PUBLIK_GATE_MODE=optional is for a test build.')
        }
    }
}
tasks.matching { it.name == 'preReleaseBuild' }.configureEach {
    doFirst {
        def publikToken = System.getenv('PUBLIK_APP_TOKEN') ?: ''
        if (!(publikToken ==~ /pat_[A-Za-z0-9_-]{8,200}/) || publikToken.contains('REPLACE_ME')) {
            throw new GradleException('publik: this release build has no publik app token. Set PUBLIK_APP_TOKEN (pat_) in the build environment.')
        }
    }
}
`

const KOTLIN = `
// publik: build rules (plugins/withPublikTokenCheck.js).
tasks.matching { it.name == "preBuild" }.configureEach {
    doFirst {
        val publikHooks = System.getenv("PUBLIK_TEST_HOOKS") == "1" || System.getenv("EXPO_PUBLIC_PUBLIK_TEST_HOOKS") == "1"
        val publikStore = listOf("1", "true").contains(System.getenv("EXPO_PUBLIC_APP_STORE_BUILD") ?: "")
        if (publikHooks && publikStore) {
            throw GradleException("publik: an App Store build (EXPO_PUBLIC_APP_STORE_BUILD) must not have the test hooks (PUBLIK_TEST_HOOKS).")
        }
        if (publikStore && System.getenv("EXPO_PUBLIC_PUBLIK_GATE_MODE") == "optional") {
            throw GradleException("publik: an App Store build (EXPO_PUBLIC_APP_STORE_BUILD) always has the required gate; EXPO_PUBLIC_PUBLIK_GATE_MODE=optional is for a test build.")
        }
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        val token = System.getenv("PUBLIK_APP_TOKEN") ?: ""
        if (!Regex("pat_[A-Za-z0-9_-]{8,200}").matches(token) || token.contains("REPLACE_ME")) {
            throw GradleException("publik: this release build has no publik app token. Set PUBLIK_APP_TOKEN (pat_) in the build environment.")
        }
    }
}
`

function withAndroidCheck(config) {
  return withAppBuildGradle(config, (cfg) => {
    const src = cfg.modResults.contents
    if (!src.includes('withPublikTokenCheck')) {
      cfg.modResults.contents = src + (cfg.modResults.language === 'kt' ? KOTLIN : GROOVY)
    }
    return cfg
  })
}

module.exports = function withPublikTokenCheck(config) {
  return withAndroidCheck(withIosCheck(config))
}
// For src/publik-token-check.test.ts, which runs the iOS phase's script.
module.exports.PHASE_NAME = PHASE_NAME
module.exports.SCRIPT = SCRIPT
module.exports.GROOVY = GROOVY
module.exports.KOTLIN = KOTLIN
