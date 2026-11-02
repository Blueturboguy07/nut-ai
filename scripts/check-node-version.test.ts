import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The preinstall guard. On Node 20 the install used to pass with an engines
 * WARNING and the corpus build then died on node:sqlite (Nov 1 2026).
 */
const require = createRequire(import.meta.url)
const { tooOld, MIN } = require('./check-node-version.cjs') as { tooOld: (v: string) => boolean; MIN: string }
const SCRIPT = fileURLToPath(new URL('./check-node-version.cjs', import.meta.url))

describe('check-node-version', () => {
  it('the floor is 22.13.0, where node:sqlite needs no flag', () => {
    expect(MIN).toBe('22.13.0')
  })

  it('rejects every Node without node:sqlite', () => {
    for (const v of ['v18.20.4', '20.11.0', '20.19.5', '22.0.0', '22.12.0', 'v22.12.9']) expect(tooOld(v), v).toBe(true)
  })

  it('accepts 22.13 and newer', () => {
    for (const v of ['22.13.0', 'v22.23.4', '23.0.0', '24.18.0', '26.1.0']) expect(tooOld(v), v).toBe(false)
  })

  it('passes on the Node running this test (>= 22.13: vitest uses node:sqlite tests too)', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' })).not.toThrow()
  })

  // Only where an old Node is installed (Homebrew's node@18 on the Mac that wrote this).
  const OLD_NODE = ['/opt/homebrew/opt/node@18/bin/node', '/usr/local/opt/node@18/bin/node'].find((p) => existsSync(p))
  it.skipIf(!OLD_NODE)('exits 1 with the reason on a real old Node', () => {
    let status = 0
    let stderr = ''
    try {
      execFileSync(OLD_NODE!, [SCRIPT], { stdio: 'pipe' })
    } catch (e) {
      status = (e as { status: number }).status
      stderr = String((e as { stderr: Buffer }).stderr)
    }
    expect(status).toBe(1)
    expect(stderr).toContain('Nut AI needs Node 22.13.0 or newer')
    expect(stderr).toContain('node:sqlite')
  })
})
