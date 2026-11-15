import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The build flags of an iOS release build (no Metro, so not a dev build):
 * an App Store build always has the required gate and never the test hooks,
 * and only a dev build accepts Claude subscription tokens.
 */

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

const KEYS = ['EXPO_PUBLIC_APP_STORE_BUILD', 'EXPO_PUBLIC_PUBLIK_GATE_MODE', 'EXPO_PUBLIC_PUBLIK_TEST_HOOKS'] as const
type Env = Partial<Record<(typeof KEYS)[number], string>>
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

async function flags(env: Env) {
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, env)
  vi.resetModules()
  return import('./build-flags')
}

afterEach(() => {
  for (const k of KEYS) {
    const v = saved[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('build flags', () => {
  it('an iOS release build is an App Store build: the gate is required and the test hooks are off', async () => {
    const f = await flags({ EXPO_PUBLIC_PUBLIK_GATE_MODE: 'optional', EXPO_PUBLIC_PUBLIK_TEST_HOOKS: '1' })
    expect(f.APP_STORE_BUILD).toBe(true)
    expect(f.PUBLIK_GATE_MODE).toBe('required')
    expect(f.PUBLIK_TEST_HOOKS).toBe(false)
    expect(f.CLAUDE_SUBSCRIPTION_TOKENS).toBe(false)
  })

  it('a CI test build (EXPO_PUBLIC_APP_STORE_BUILD=0) may have the optional gate and the test hooks', async () => {
    const f = await flags({ EXPO_PUBLIC_APP_STORE_BUILD: '0', EXPO_PUBLIC_PUBLIK_GATE_MODE: 'optional', EXPO_PUBLIC_PUBLIK_TEST_HOOKS: '1' })
    expect(f.APP_STORE_BUILD).toBe(false)
    expect(f.PUBLIK_GATE_MODE).toBe('optional')
    expect(f.PUBLIK_TEST_HOOKS).toBe(true)
    // Claude subscription tokens: a dev build (Metro) only, never a release build.
    expect(f.CLAUDE_SUBSCRIPTION_TOKENS).toBe(false)
  })
})
