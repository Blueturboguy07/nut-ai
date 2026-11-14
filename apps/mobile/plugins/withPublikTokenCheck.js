const { withAppBuildGradle, withXcodeProject } = require('@expo/config-plugins')

/**
 * A RELEASE build with no publik app token fails (publik gate rule).
 *
 * The app token (pat_) lives in apps/mobile/publik-build.json and is how the
 * phone mints its publik key. A release build without one would ship an app
 * whose Sign in with publik can never work, so the build stops instead:
 *
 *   iOS: a "Check publik app token" build phase on the app target; it fails
 *        a Release configuration when the file has no pat_ token or still
 *        has the placeholder (REPLACE_ME). Debug builds are not checked.
 *   Android: the same check before every release variant (preReleaseBuild).
 *
 * The check reads the file only for its form; it never prints the token.
 */

const PHASE_NAME = 'Check publik app token'
const SCRIPT = [
  'if [ "$CONFIGURATION" = "Release" ]; then',
  'F="$PROJECT_DIR/../publik-build.json";',
  `if ! grep -Eq '"appToken"[[:space:]]*:[[:space:]]*"pat_[A-Za-z0-9_-]{8,200}"' "$F" || grep -q 'REPLACE_ME' "$F"; then`,
  'echo "error: publik: this Release build has no publik app token (pat_) in apps/mobile/publik-build.json."; exit 1;',
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
        // Declared, so the phase may read the file with user script sandboxing on.
        inputPaths: ['"$(PROJECT_DIR)/../publik-build.json"'],
        outputPaths: [],
      })
    }
    return cfg
  })
}

const GROOVY = `
// publik: a release build needs the app token (plugins/withPublikTokenCheck.js).
tasks.matching { it.name == 'preReleaseBuild' }.configureEach {
    doFirst {
        def publikToken = new groovy.json.JsonSlurper().parse(file('../../publik-build.json')).appToken
        if (!(publikToken instanceof String) || !(publikToken ==~ /pat_[A-Za-z0-9_-]{8,200}/) || publikToken.contains('REPLACE_ME')) {
            throw new GradleException('publik: this release build has no publik app token (pat_) in apps/mobile/publik-build.json.')
        }
    }
}
`

const KOTLIN = `
// publik: a release build needs the app token (plugins/withPublikTokenCheck.js).
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        @Suppress("UNCHECKED_CAST")
        val publik = groovy.json.JsonSlurper().parse(file("../../publik-build.json")) as Map<String, Any?>
        val token = publik["appToken"] as? String ?: ""
        if (!Regex("pat_[A-Za-z0-9_-]{8,200}").matches(token) || token.contains("REPLACE_ME")) {
            throw GradleException("publik: this release build has no publik app token (pat_) in apps/mobile/publik-build.json.")
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
module.exports.SCRIPT = SCRIPT
module.exports.GROOVY = GROOVY
