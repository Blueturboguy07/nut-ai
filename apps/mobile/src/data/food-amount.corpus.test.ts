import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openNodeDb } from '@nutai/db-adapter/node'
import { amountTotals, foodFacts } from './food-amount'
import { searchFoods } from './food-search'

/**
 * The real bundled corpus (apps/mobile/assets/nutrition.db, built by `npm run
 * data:build`; not in git). CI builds it before the unit tests
 * (mobile-build.yml, job "test"); without the file this suite is skipped.
 *
 * Blind test round 2 (Nov 15 2026): "Bananas, raw" logged 450 kcal and one
 * whole egg 38 kcal (N4); "rice" found no plain rice and "banana" listed one
 * food twice (N6). These checks run the screen's own search and amount rules
 * on the real data.
 */

const DB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'nutrition.db')
const have = existsSync(DB)

describe.skipIf(!have)('the real food database', () => {
  const open = () => openNodeDb(DB, { readonly: true })

  async function top(query: string) {
    const r = await searchFoods(open(), query)
    console.log(`search "${query}":`, r.results.slice(0, 5).map((x) => x.name).join(' | '))
    return r.results
  }

  async function defaultOf(name: RegExp, query: string) {
    const hit = (await top(query)).find((x) => name.test(x.name))
    expect(hit, `no ${name} for "${query}"`).toBeDefined()
    const f = (await foodFacts(open(), hit!.foodId))!
    const s = f.servings[f.defaultIndex]!
    const kcal = amountTotals(f.per100, s.grams).kcal
    console.log(`${f.name}: default ${s.label} = ${s.grams} g, ${kcal} kcal`)
    return { s, kcal }
  }

  it('a medium banana is about 105 kcal', async () => {
    const { kcal } = await defaultOf(/^Bananas?, raw$/i, 'banana')
    expect(kcal).toBeGreaterThanOrEqual(95)
    expect(kcal).toBeLessThanOrEqual(115)
  })

  it('a large egg is about 72 kcal', async () => {
    const { kcal } = await defaultOf(/^Eggs?, (whole, )?raw/i, 'egg')
    expect(kcal).toBeGreaterThanOrEqual(65)
    expect(kcal).toBeLessThanOrEqual(80)
  })

  it('"banana": a plain banana first, no name twice', async () => {
    const r = await top('banana')
    expect(r[0]?.name).toMatch(/^Bananas?, /i)
    const names = r.map((x) => x.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it('"rice": plain rice in the first three, cooked rice before a restaurant dish', async () => {
    const r = await top('rice')
    expect(r.slice(0, 3).some((x) => /^Rice, (white|brown)/i.test(x.name))).toBe(true)
    expect(r[0]?.name).not.toMatch(/restaurant/i)
  })

  it('"egg": a whole egg first, not a dried one', async () => {
    const r = await top('egg')
    expect(r[0]?.name).toMatch(/^Eggs?, whole/i)
    expect(r.slice(0, 3).some((x) => /dried|powder/i.test(x.name))).toBe(false)
  })
})
