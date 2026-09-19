import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The committed build file and the secret-in-source guard.
 *
 * `publik-build.json` may carry the public app token (a publishable
 * identifier) or the placeholder — nothing else that looks like a key may
 * appear anywhere under apps/mobile or packages.
 */

const MOBILE = join(__dirname, '..', '..')
const ROOT = join(MOBILE, '..', '..')

describe('publik-build.json', () => {
  const cfg = JSON.parse(readFileSync(join(MOBILE, 'publik-build.json'), 'utf8'))

  it('carries the placeholder or a minted nut-ai token, and the live base URL', () => {
    expect(cfg.appToken).toMatch(/^(pat_nut-ai_REPLACE_ME|pat_nut-ai_[a-z0-9]{32})$/)
    expect(cfg.appSlug).toBe('nut-ai')
    expect(cfg.baseUrl).toBe('https://publikhq.com/api/v1')
    expect(Number.isInteger(cfg.disclosureVersion) && cfg.disclosureVersion >= 1).toBe(true)
  })

  it('names a tier alias for scans and for text', () => {
    expect(cfg.models.scan).toMatch(/^publik-(fast|balanced|smart)$/)
    expect(cfg.models.text).toMatch(/^publik-(fast|balanced|smart)$/)
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'ios' || name === 'android' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs|json)$/.test(name)) out.push(p)
  }
  return out
}

describe('no key in source', () => {
  it('nothing under apps/mobile or packages contains a pk_live, sk-ant or sk- key', () => {
    const offenders: string[] = []
    for (const f of [...walk(join(ROOT, 'apps', 'mobile')), ...walk(join(ROOT, 'packages'))]) {
      const text = readFileSync(f, 'utf8')
      // A real key: the publik shape with its 12+32 id, or a vendor secret.
      if (/\bpk_(live|test)_[a-z0-9]{12}_[a-z0-9]{32}\b|\bsk-ant-api[0-9A-Za-z_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{20,}/.test(text)) {
        offenders.push(f)
      }
    }
    expect(offenders).toEqual([])
  })
})
