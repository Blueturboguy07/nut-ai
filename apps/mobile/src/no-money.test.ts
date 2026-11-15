import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as TS from 'typescript'
import { describe, expect, it } from 'vitest'
import { classifyGatewayError, gateScreen, type GateWallet } from './inference/publik-core'
import { GET_A_PLAN_ELSEWHERE, disclosureCostSentence, planLimitMessage } from './inference/publik-copy'

/**
 * Founder rule (Nov 14 2026): no indication anywhere in the app of how much
 * money a person spends. AI use shows only as a percent of the plan limit.
 *
 * This test reads every screen and module of the app (not the tests) with
 * the TypeScript parser and fails when any piece of literal text — a string,
 * a template, JSX text — has a "$" followed by a digit, or a "$" right
 * before a template value (`$${amount}`). Comments are not text, so they
 * never count.
 *
 * App Store review (Nov 14 2026): outside the US storefront NO price text
 * shows anywhere. The price phrases of earlier versions ("50% of the model's
 * published list price", "$0.05 of free use", "Add a plan or pack", "Raise
 * the cap") are banned from all literal text, and every publik screen and
 * failure built with purchase links off is checked for price words and links.
 */

const ts = createRequire(__filename)('typescript') as typeof TS

const MOBILE = join(__dirname, '..')
const SKIP_DIRS = new Set(['node_modules', 'ios', 'android', '.expo', 'build', 'dist'])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(p))
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

/** Every piece of literal text in a file (strings, templates, JSX text); `beforeValue`: a template part right before a `${value}`. */
function literalsIn(fileName: string, code: string): Array<{ line: number; text: string; beforeValue: boolean }> {
  const src = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: Array<{ line: number; text: string; beforeValue: boolean }> = []
  const add = (n: TS.Node, text: string, beforeValue: boolean) =>
    found.push({ line: src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1, text, beforeValue })
  const visit = (n: TS.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n) || ts.isTemplateTail(n)) add(n, n.text, false)
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n)) add(n, n.text, true)
    ts.forEachChild(n, visit)
  }
  visit(src)
  return found
}

const hit = (l: { line: number; text: string }) => `${l.line}: ${l.text.trim().slice(0, 120)}`

/** Each "$ + digit" (or "$" before a template value) in the literal text of a file, as "line: text". */
function moneyIn(fileName: string, code: string): string[] {
  return literalsIn(fileName, code)
    .filter((l) => /\$\s?\d/.test(l.text) || (l.beforeValue && /\$$/.test(l.text)))
    .map(hit)
}

/** The price phrases of earlier versions, banned from all literal text. */
const PRICE_PHRASES = [/list price/i, /published price/i, /plan or pack/i, /raise the cap/i, /\bof free use\b/i, /see charges/i, /\b(price|cost) per\b/i]

function pricePhrasesIn(fileName: string, code: string): string[] {
  return literalsIn(fileName, code)
    .filter((l) => PRICE_PHRASES.some((re) => re.test(l.text)))
    .map(hit)
}

const appFiles = () => [...walk(join(MOBILE, 'app')), ...walk(join(MOBILE, 'src')), ...walk(join(MOBILE, 'modules'))]

describe('no money in the app', () => {
  it('the scan catches every form of an amount, and never a comment', () => {
    const sample = [
      "const a = 'Starts at $0.00'",
      'const b = `~$${cost.toFixed(4)} per scan`',
      'const c = `left: $ 5`',
      'const d = <Text>Link for $0.05 of free use</Text>',
      'const e = <Card sublabel="Priced at $2 a month" />',
      '// a comment may say $0.05',
      '/* and $1.25 here */',
      "const f = '62% of your plan used'",
      'const g = `${n}% of your plan used`',
    ].join('\n')
    expect(moneyIn('sample.tsx', sample).map((s) => s.split(':')[0])).toEqual(['1', '2', '3', '4', '5'])
  })

  it('no screen or module of the app has a user-facing "$" followed by a digit', () => {
    const files = appFiles()
    expect(files.length).toBeGreaterThan(50)
    const offenders: string[] = []
    for (const f of files) {
      for (const h of moneyIn(f, readFileSync(f, 'utf8'))) offenders.push(`${f.slice(MOBILE.length + 1)}:${h}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('no price text outside the US storefront (App Store review, Nov 14 2026)', () => {
  it('the phrase scan catches the old price phrases, and never a comment', () => {
    const sample = [
      "const a = 'Billed at 50% of the model\\'s published list price'",
      'const b = <Text>Add a plan or pack</Text>',
      "const c = { label: 'Raise the cap' }",
      'const d = `Link for ${amount} of free use`',
      '// a comment may say Raise the cap',
      "const e = 'Linking this phone gives some free use, once'",
    ].join('\n')
    expect(pricePhrasesIn('sample.tsx', sample).map((s) => s.split(':')[0])).toEqual(['1', '2', '3', '4'])
  })

  it('no screen or module of the app has an old price phrase', () => {
    const offenders: string[] = []
    for (const f of appFiles()) {
      for (const h of pricePhrasesIn(f, readFileSync(f, 'utf8'))) offenders.push(`${f.slice(MOBILE.length + 1)}:${h}`)
    }
    expect(offenders).toEqual([])
  })

  it('with purchase links off, no publik screen, sentence or failure has a price, a purchase link or a URL', () => {
    const PRICE_TEXT = [/\$/, /\bprices?\b/i, /list price/i, /plan or pack/i, /raise the cap/i, /of free use/i, /at the link below/i, /https?:\/\//i, /\bpublikhq\.com\/(wallet|dashboard|pricing)/i]
    const texts: string[] = [
      disclosureCostSentence('Nut AI', false),
      planLimitMessage(null, false),
      planLimitMessage('2026-11-16T08:00:00Z', false, new Date('2026-11-14T12:00:00Z')),
    ]
    expect(texts[0]).toContain(GET_A_PLAN_ELSEWHERE)

    const claimed = (plan: GateWallet['plan'], balanceMicros: number): GateWallet => ({
      claimState: 'claimed',
      claimUrl: null,
      handle: 'sam',
      plan,
      balanceMicros,
      topUpUrl: 'https://publikhq.com/dashboard/api/add',
    })
    const wallets: Array<GateWallet | null> = [
      null,
      claimed({ kind: 'none', label: null }, 0),
      claimed({ kind: 'none', label: null }, 5_000_000),
      claimed({ kind: 'plan', label: 'Pro' }, 5_000_000),
      claimed({ kind: 'pack', label: 'Builder pack' }, 5_000_000),
    ]
    for (const w of wallets) {
      for (const id of ['sign_in', 'unreachable', 'choose'] as const) {
        const screen = gateScreen(id, w, null, undefined, false)
        expect(screen.buttons.map((b) => b.action)).not.toContain('get_plan')
        texts.push(screen.title, screen.body, ...screen.buttons.map((b) => b.label))
      }
    }

    const TYPES = [
      'insufficient_credit',
      'daily_cap_reached',
      'week_budget_reached',
      'model_requires_claim',
      'key_revoked',
      'invalid_api_key',
      'unknown_model',
      'gateway_unavailable',
      'rate_limit_exceeded',
    ]
    for (const type of TYPES) {
      for (const claim_state of ['anonymous', 'claimed']) {
        for (const message of ['You have $0.00 left. Add a plan or pack.', 'Raise the cap on your dashboard.', 'Top up at the list price.']) {
          const body = JSON.stringify({
            error: { type, claim_state, message, top_up_url: 'https://publikhq.com/dashboard/api/add', claim_url: 'https://publikhq.com/claim/A' },
          })
          const f = classifyGatewayError(402, body, false)
          expect(f, type).not.toBeNull()
          expect(f!.action, type).toBeUndefined()
          texts.push(f!.message)
        }
      }
    }

    const offenders = texts.filter((t) => PRICE_TEXT.some((re) => re.test(t)))
    expect(offenders).toEqual([])
  })
})
