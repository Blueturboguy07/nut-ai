import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The publik copy rule, enforced: the provider is "publik API"; money is
 * dollars — never "OpenAI API access", never "ChatGPT credits", never tokens
 * or "credits" as a unit in the publik copy itself.
 */

const MOBILE = join(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('publik copy rule', () => {
  it('no screen or module says "OpenAI API access" or "ChatGPT credits"', () => {
    const offenders: string[] = []
    for (const f of [...walk(join(MOBILE, 'app')), ...walk(join(MOBILE, 'src'))]) {
      if (f.endsWith('copy.test.ts')) continue
      if (/OpenAI API access|ChatGPT credits/i.test(readFileSync(f, 'utf8'))) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it('the publik copy never prices in tokens or "credits"', () => {
    const text = readFileSync(join(MOBILE, 'src', 'inference', 'publik-copy.ts'), 'utf8')
    // Strip the file's own header comment, which names the rule.
    const body = text.slice(text.indexOf('export const APP_NAME'))
    expect(/\btokens?\b/i.test(body)).toBe(false)
    expect(/\bcredits\b/i.test(body)).toBe(false)
    expect(body).toContain('publik API')
  })
})
