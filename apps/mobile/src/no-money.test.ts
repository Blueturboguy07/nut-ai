import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Founder rule (Nov 14 2026): no indication anywhere in the app of how much
 * money a person spends. AI use shows only as a percent of the plan limit.
 *
 * This test reads every screen and module of the app (not the tests) with
 * the TypeScript parser and fails when any piece of literal text — a string,
 * a template, JSX text — has a "$" followed by a digit, or a "$" right
 * before a template value (`$${amount}`). Comments are not text, so they
 * never count.
 */

const ts = createRequire(__filename)('typescript') as typeof import('typescript')

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

/** Each "$ + digit" (or "$" before a template value) in the literal text of a file, as "line: text". */
function moneyIn(fileName: string, code: string): string[] {
  const src = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: string[] = []
  const check = (n: ts.Node, text: string, beforeValue: boolean) => {
    if (/\$\s?\d/.test(text) || (beforeValue && /\$$/.test(text))) {
      found.push(`${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}: ${text.trim().slice(0, 120)}`)
    }
  }
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n) || ts.isTemplateTail(n)) check(n, n.text, false)
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n)) check(n, n.text, true)
    ts.forEachChild(n, visit)
  }
  visit(src)
  return found
}

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
    const files = [...walk(join(MOBILE, 'app')), ...walk(join(MOBILE, 'src')), ...walk(join(MOBILE, 'modules'))]
    expect(files.length).toBeGreaterThan(50)
    const offenders: string[] = []
    for (const f of files) {
      for (const hit of moneyIn(f, readFileSync(f, 'utf8'))) offenders.push(`${f.slice(MOBILE.length + 1)}:${hit}`)
    }
    expect(offenders).toEqual([])
  })
})
