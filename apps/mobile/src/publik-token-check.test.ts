import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * A release build with no publik app token fails (plugins/withPublikTokenCheck.js).
 * The iOS build phase's script runs here as Xcode runs it, against a
 * publik-build.json next to a fake ios/ folder. The Android half runs in CI
 * (mobile-build.yml: the negative test before the APK build).
 */

const plugin = createRequire(__filename)('../plugins/withPublikTokenCheck.js') as { SCRIPT: string; GROOVY: string }
const root = mkdtempSync(join(tmpdir(), 'publik-token-check-'))
mkdirSync(join(root, 'ios'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function phase(configuration: string, appToken: unknown): number {
  writeFileSync(join(root, 'publik-build.json'), JSON.stringify({ appToken, appSlug: 'nut-ai' }, null, 2))
  try {
    execFileSync('/bin/sh', ['-c', plugin.SCRIPT], { env: { ...process.env, CONFIGURATION: configuration, PROJECT_DIR: join(root, 'ios') }, stdio: 'pipe' })
    return 0
  } catch (e) {
    return (e as { status?: number }).status ?? 1
  }
}

// Shaped like a token; not a real one.
const SHAPED = `pat_nut-ai_${'x'.repeat(32)}`

describe('the release token check (iOS build phase)', () => {
  it('fails a Release build with no token, an empty one, or the placeholder', () => {
    expect(phase('Release', undefined)).not.toBe(0)
    expect(phase('Release', '')).not.toBe(0)
    expect(phase('Release', 'pat_REPLACE_ME_with_the_token')).not.toBe(0)
    expect(phase('Release', 'pk_live_notanapptoken')).not.toBe(0)
  })

  it('passes a Release build with a token, and never checks a Debug build', () => {
    expect(phase('Release', SHAPED)).toBe(0)
    expect(phase('Debug', '')).toBe(0)
  })

  it('the Android half checks the same file before every release variant', () => {
    expect(plugin.GROOVY).toContain("it.name == 'preReleaseBuild'")
    expect(plugin.GROOVY).toContain("file('../../publik-build.json')")
    expect(plugin.GROOVY).toContain('REPLACE_ME')
  })
})
