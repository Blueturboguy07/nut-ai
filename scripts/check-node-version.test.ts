import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The preinstall guard. On Node 20 the install used to pass with an engines
 * WARNING and the corpus build then died on node:sqlite (Nov 1 2026). On
 * Node 22.13-22.15 and 23.x it passed the first guard and died at
 * data:build with "no such module: fts5" (blind verify, Nov 1 2026).
 */
const require = createRequire(import.meta.url)
const guard = require('./check-node-version.cjs') as {
  MIN: string
  tooOld: (v: string) => boolean
  supported: (v: string) => boolean
  sqliteProblem: (load?: () => unknown) => string | null
  problem: (v: string, probe?: () => string | null) => string | null
}
const SCRIPT = fileURLToPath(new URL('./check-node-version.cjs', import.meta.url))
const pkg = require('../package.json') as { engines: { node: string } }

describe('check-node-version', () => {
  it('the floor is 22.16.0, the first 22.x whose node:sqlite has FTS5', () => {
    expect(guard.MIN).toBe('22.16.0')
  })

  it('rejects every Node without node:sqlite or without FTS5 in it', () => {
    const bad = [
      'v18.20.4', '20.11.0', '20.19.5', '22.0.0', '22.12.0', 'v22.12.9',
      // node:sqlite without FTS5 (verified: "no such module: fts5")
      '22.13.0', 'v22.13.1', '22.14.0', '22.15.0', '22.15.9',
      // 23.0-23.3: no unflagged node:sqlite; 23.4-23.11: no FTS5
      '23.0.0', '23.3.0', '23.4.0', '23.11.0', 'v23.99.0',
    ]
    for (const v of bad) expect(guard.supported(v), v).toBe(false)
  })

  it('accepts 22.16 and newer 22.x, and 24 and newer', () => {
    for (const v of ['22.16.0', 'v22.16.1', '22.23.4', '24.0.0', 'v24.18.0', '25.2.0', '26.1.0'])
      expect(guard.supported(v), v).toBe(true)
  })

  it('package.json engines say the same thing', () => {
    expect(pkg.engines.node).toBe('^22.16.0 || >=24.0.0')
  })

  it('names the floor and Node 23 when the version is wrong', () => {
    const message = guard.problem('22.13.0', () => null)
    expect(message).toContain('Nut AI needs Node 22.16.0 or newer, and not Node 23.')
    expect(message).toContain('This terminal runs Node 22.13.0.')
    expect(message).toContain('FTS5')
    expect(guard.problem('v23.11.0', () => null)).toContain('This terminal runs Node 23.11.0.')
  })

  it('stops a good version number when the real probe fails, and says why', () => {
    const message = guard.problem('24.18.0', () => 'no such module: fts5')
    expect(message).toContain("Nut AI needs a Node whose built-in node:sqlite has FTS5")
    expect(message).toContain('the check failed: no such module: fts5')
    expect(guard.problem('24.18.0', () => null)).toBeNull()
  })

  it('the probe reports a missing module or a missing fts5', () => {
    expect(
      guard.sqliteProblem(() => {
        throw new Error('No such built-in module: node:sqlite')
      }),
    ).toBe('No such built-in module: node:sqlite')
    const noFts5 = {
      DatabaseSync: class {
        exec() {
          throw new Error('no such module: fts5')
        }
        close() {}
      },
    }
    expect(guard.sqliteProblem(() => noFts5)).toBe('no such module: fts5')
  })

  it('the probe passes on the Node running this test (vitest runs the node:sqlite tests too)', () => {
    expect(guard.sqliteProblem()).toBeNull()
  })

  it('passes on the Node running this test, silently (no node:sqlite ExperimentalWarning)', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe('')
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
    expect(stderr).toContain('Nut AI needs Node 22.16.0 or newer, and not Node 23.')
    expect(stderr).toContain('node:sqlite')
  })
})
