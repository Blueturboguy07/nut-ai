import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { disclosureCostSentence, planLimitMessage } from './inference/publik-copy'

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

  // publik migration 0059 (2026-09-28): the one free thing is some use, once
  // per account, at the first link.
  it('no screen or module promises free use before the phone is linked', () => {
    const banned = /free starter|starts with free|free usage|small free balance|first \$0\.25|\$0\.25 free/i
    const offenders: string[] = []
    for (const f of [...walk(join(MOBILE, 'app')), ...walk(join(MOBILE, 'src'))]) {
      if (f.endsWith('copy.test.ts')) continue
      if (banned.test(readFileSync(f, 'utf8'))) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it('the disclosure names the free use at the link and the plan limit, with no amount of money (founder rule, Nov 14 2026)', () => {
    const disclosure = disclosureCostSentence('Nut AI')
    expect(disclosure).toContain('linking this phone to your publik account gives some free use, once')
    expect(disclosure).toContain('when your plan limit is reached Nut AI tells you')
    for (const text of [disclosure, disclosureCostSentence('Nut AI', false), planLimitMessage(null, true), planLimitMessage(null, false)]) {
      expect(text).not.toMatch(/\$|\d+%|list price|per scan/)
    }
    expect(planLimitMessage(null, true)).not.toMatch(/free/i)
  })
})
