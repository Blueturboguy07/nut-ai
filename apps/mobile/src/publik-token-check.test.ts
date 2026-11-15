import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * The build rules of plugins/withPublikTokenCheck.js. The iOS build phase's
 * script runs here as Xcode runs it, with the build environment it reads:
 *   1. a Release build takes the app token only from PUBLIK_APP_TOKEN;
 *   2. an App Store build never has the test hooks;
 *   3. an App Store build always has the required gate.
 * The Android half runs in CI (mobile-build.yml: the negative tests before
 * the APK build, and the hooks-off android-release-check job).
 */

const plugin = createRequire(__filename)('../plugins/withPublikTokenCheck.js') as {
  PHASE_NAME: string
  SCRIPT: string
  GROOVY: string
  KOTLIN: string
}

const BUILD_KEYS = [
  'PUBLIK_APP_TOKEN',
  'PUBLIK_TEST_HOOKS',
  'EXPO_PUBLIC_PUBLIK_TEST_HOOKS',
  'EXPO_PUBLIC_APP_STORE_BUILD',
  'EXPO_PUBLIC_PUBLIK_GATE_MODE',
  'CONFIGURATION',
] as const
type BuildEnv = Partial<Record<(typeof BUILD_KEYS)[number], string>>

function phase(env: BuildEnv): { status: number; out: string } {
  const base: Record<string, string | undefined> = { ...process.env }
  // Only what this test sets: never the runner's own build variables.
  for (const k of BUILD_KEYS) delete base[k]
  try {
    const out = execFileSync('/bin/sh', ['-c', plugin.SCRIPT], { env: { ...base, ...env } as NodeJS.ProcessEnv, stdio: 'pipe' })
    return { status: 0, out: String(out) }
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer }
    return { status: err.status ?? 1, out: String(err.stdout ?? '') }
  }
}

// Shaped like a token; not a real one.
const SHAPED = `pat_nut-ai_${'x'.repeat(32)}`

describe('rule 1: a Release build takes the app token only from PUBLIK_APP_TOKEN (iOS build phase)', () => {
  it('fails a Release build with no token, an empty one, the placeholder, or another shape', () => {
    const store = { EXPO_PUBLIC_APP_STORE_BUILD: '0' }
    expect(phase({ ...store, CONFIGURATION: 'Release' }).status).not.toBe(0)
    expect(phase({ ...store, CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: '' }).status).not.toBe(0)
    expect(phase({ ...store, CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: 'pat_nut-ai_REPLACE_ME' }).status).not.toBe(0)
    expect(phase({ ...store, CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: 'pk_live_notanapptoken' }).status).not.toBe(0)
    expect(phase({ ...store, CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: 'pat_short' }).status).not.toBe(0)
    expect(phase({ ...store, CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: `${SHAPED} x` }).status).not.toBe(0)
    expect(phase({ ...store, CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: `pat_${'a'.repeat(201)}` }).status).not.toBe(0)
  })

  it('passes a Release build with a token, and never asks a Debug build for one', () => {
    expect(phase({ CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: SHAPED }).status).toBe(0)
    expect(phase({ CONFIGURATION: 'Debug' }).status).toBe(0)
  })

  it('never prints the token', () => {
    const r = phase({ CONFIGURATION: 'Release', PUBLIK_APP_TOKEN: `${SHAPED}!` })
    expect(r.status).not.toBe(0)
    expect(r.out).toContain('has no publik app token')
    expect(r.out).not.toContain(SHAPED)
  })
})

describe('rule 2: an App Store build never has the test hooks', () => {
  const token = { PUBLIK_APP_TOKEN: SHAPED }
  it('fails an iOS Release build with the hooks unless EXPO_PUBLIC_APP_STORE_BUILD=0', () => {
    for (const hooks of [{ PUBLIK_TEST_HOOKS: '1' }, { EXPO_PUBLIC_PUBLIK_TEST_HOOKS: '1' }]) {
      // An iOS Release build is an App Store build by default (build-flags.ts).
      const r = phase({ ...token, ...hooks, CONFIGURATION: 'Release' })
      expect(r.status).not.toBe(0)
      expect(r.out).toContain('must not have the test hooks')
      expect(phase({ ...token, ...hooks, CONFIGURATION: 'Release', EXPO_PUBLIC_APP_STORE_BUILD: '1' }).status).not.toBe(0)
      expect(phase({ ...token, ...hooks, CONFIGURATION: 'Debug', EXPO_PUBLIC_APP_STORE_BUILD: 'true' }).status).not.toBe(0)
      // The CI test builds.
      expect(phase({ ...token, ...hooks, CONFIGURATION: 'Release', EXPO_PUBLIC_APP_STORE_BUILD: '0' }).status).toBe(0)
      expect(phase({ ...token, ...hooks, CONFIGURATION: 'Debug' }).status).toBe(0)
    }
  })

  it('an App Store build with no hooks passes', () => {
    expect(phase({ ...token, CONFIGURATION: 'Release' }).status).toBe(0)
    expect(phase({ ...token, CONFIGURATION: 'Release', EXPO_PUBLIC_APP_STORE_BUILD: '1', PUBLIK_TEST_HOOKS: '0' }).status).toBe(0)
  })
})

describe('rule 3: an App Store build always has the required gate', () => {
  const token = { PUBLIK_APP_TOKEN: SHAPED }
  it('fails an App Store build that asks for the optional gate; a test build may', () => {
    const r = phase({ ...token, CONFIGURATION: 'Release', EXPO_PUBLIC_PUBLIK_GATE_MODE: 'optional' })
    expect(r.status).not.toBe(0)
    expect(r.out).toContain('always has the required gate')
    expect(phase({ ...token, CONFIGURATION: 'Release', EXPO_PUBLIC_PUBLIK_GATE_MODE: 'required' }).status).toBe(0)
    // The CI optional artifact: a test-hooks build that is not an App Store build.
    expect(
      phase({ ...token, CONFIGURATION: 'Release', EXPO_PUBLIC_APP_STORE_BUILD: '0', PUBLIK_TEST_HOOKS: '1', EXPO_PUBLIC_PUBLIK_GATE_MODE: 'optional' }).status,
    ).toBe(0)
  })
})

describe('the Android half', () => {
  it('checks the same two rules from the build environment, in Groovy and in Kotlin', () => {
    for (const src of [plugin.GROOVY, plugin.KOTLIN]) {
      expect(src).toContain('withPublikTokenCheck')
      expect(src).toMatch(/it\.name == ["']preBuild["']/)
      expect(src).toMatch(/it\.name == ["']preReleaseBuild["']/)
      expect(src).toMatch(/System\.getenv\(["']PUBLIK_APP_TOKEN["']\)/)
      expect(src).toMatch(/System\.getenv\(["']EXPO_PUBLIC_APP_STORE_BUILD["']\)/)
      expect(src).toMatch(/System\.getenv\(["']PUBLIK_TEST_HOOKS["']\)/)
      expect(src).toMatch(/System\.getenv\(["']EXPO_PUBLIC_PUBLIK_GATE_MODE["']\)/)
      expect(src).toContain('REPLACE_ME')
      // The committed file is not a source of the token for a release build.
      expect(src).not.toContain('publik-build.json')
    }
  })

  it('the iOS phase has a fixed name (CI looks for it in the Xcode project)', () => {
    expect(plugin.PHASE_NAME).toBe('Check publik build settings')
  })
})
