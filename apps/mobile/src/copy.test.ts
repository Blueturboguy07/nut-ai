import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { disclosureCostSentence, insufficientCreditMessage } from './inference/publik-copy'

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

  // publik migration 0059 (2026-09-28): a new install starts at $0.00, and the
  // one free thing is $0.05 of use, once per account, at the first link.
  it('no screen or module promises free use before the phone is linked', () => {
    const banned = /free starter|starts with free|free usage|small free balance|first \$0\.25|\$0\.25 free/i
    const offenders: string[] = []
    for (const f of [...walk(join(MOBILE, 'app')), ...walk(join(MOBILE, 'src'))]) {
      if (f.endsWith('copy.test.ts')) continue
      if (banned.test(readFileSync(f, 'utf8'))) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it('the disclosure and the 402 fallback say $0.00 to start and $0.05 once at the link', () => {
    const disclosure = disclosureCostSentence('Nut AI')
    expect(disclosure).toContain('A new phone starts at $0.00')
    expect(disclosure).toContain('linking this phone to your publik account gives $0.05 of free use, once')
    expect(insufficientCreditMessage('anonymous')).toContain('$0.05 of free use')
    expect(insufficientCreditMessage('claimed')).not.toMatch(/free/i)
  })
})
