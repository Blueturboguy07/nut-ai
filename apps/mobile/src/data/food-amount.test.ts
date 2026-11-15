import { beforeEach, describe, expect, it } from 'vitest'
import { NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { amountTotals, foodFacts, parseGrams, servingLabel } from './food-amount'

/**
 * Blind test round 2 (Nov 15 2026, N4): the default serving must be a
 * realistic one (a medium banana is about 105 kcal, a large egg about 72),
 * not the first portion row USDA lists ("1 cup, mashed" for a banana). The
 * portion rows below copy USDA SR Legacy's layout: "undetermined" unit, the
 * size in the modifier, the household measures first.
 */

let db: DbAdapter

async function food(id: number, name: string, kcal: number, p: number, f: number, c: number, portions: Array<[string, string, number, number, number?]>) {
  await db.run(
    `INSERT INTO foods (id, source, name, energy_kcal, protein_g, fat_g, carb_g, license) VALUES (?, 'fdc_sr_legacy', ?, ?, ?, ?, ?, 'CC0')`,
    [id, name, kcal, p, f, c],
  )
  for (const [unit, modifier, amount, grams, fndds] of portions) {
    await db.run(
      'INSERT INTO food_portions (food_id, measure_unit, modifier, amount, gram_weight, is_fndds_default) VALUES (?,?,?,?,?,?)',
      [id, unit, modifier, amount, grams, fndds ?? 0],
    )
  }
}

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec(NUTRITION_SCHEMA)
  await food(1, 'Bananas, raw', 89, 1.09, 0.33, 22.84, [
    ['undetermined', 'cup, mashed', 1, 225],
    ['undetermined', 'cup, sliced', 1, 150],
    ['undetermined', 'extra large (9" or longer)', 1, 152],
    ['undetermined', 'large (8" to 8-7/8" long)', 1, 136],
    ['undetermined', 'medium (7" to 7-7/8" long)', 1, 118],
    ['undetermined', 'small (6" to 6-7/8" long)', 1, 101],
    ['undetermined', 'NLEA serving', 1, 126],
  ])
  await food(2, 'Egg, whole, raw, fresh', 143, 12.56, 9.51, 0.72, [
    ['undetermined', 'cup (4.86 large eggs)', 1, 243],
    ['undetermined', 'extra large', 1, 56],
    ['undetermined', 'jumbo', 1, 63],
    ['undetermined', 'large', 1, 50],
    ['undetermined', 'medium', 1, 44],
    ['undetermined', 'small', 1, 38],
  ])
  await food(3, 'Oil, olive, salad or cooking', 884, 0, 100, 0, [
    ['undetermined', 'tablespoon', 1, 13.5],
    ['undetermined', 'cup', 1, 216],
  ])
  await food(4, 'Rice, white, long-grain, regular, cooked', 130, 2.69, 0.28, 28.17, [
    ['cup', '', 1, 158],
    ['undetermined', 'serving', 1, 186, 1],
  ])
  await food(5, 'Mystery food, no portions', 200, 10, 5, 20, [])
})

describe('the default serving is a realistic one', () => {
  it('a medium banana: 118 g, about 105 kcal (not "1 cup, mashed")', async () => {
    const f = (await foodFacts(db, 1))!
    const s = f.servings[f.defaultIndex]!
    expect(s.grams).toBe(118)
    expect(s.label).toBe('1 medium (7" to 7-7/8" long)')
    expect(amountTotals(f.per100, s.grams).kcal).toBe(105)
  })

  it('a large egg: 50 g, about 72 kcal (not the cup, not "extra large")', async () => {
    const f = (await foodFacts(db, 2))!
    const s = f.servings[f.defaultIndex]!
    expect(s.grams).toBe(50)
    expect(s.label).toBe('1 large')
    expect(amountTotals(f.per100, s.grams).kcal).toBe(72)
  })

  it('a household measure when nothing is sold by size: a tablespoon of oil, not 100 g', async () => {
    const f = (await foodFacts(db, 3))!
    expect(f.servings[f.defaultIndex]!.grams).toBe(13.5)
  })

  it('the FNDDS default portion before the first measure', async () => {
    const f = (await foodFacts(db, 4))!
    expect(f.servings[f.defaultIndex]!.grams).toBe(186)
  })

  it('100 g only when USDA lists no portion', async () => {
    const f = (await foodFacts(db, 5))!
    expect(f.servings).toEqual([{ label: '100 g', grams: 100 }])
    expect(f.defaultIndex).toBe(0)
  })

  it('every food also offers 100 g, and no serving twice', async () => {
    const f = (await foodFacts(db, 1))!
    expect(f.servings.at(-1)).toEqual({ label: '100 g', grams: 100 })
    const labels = f.servings.map((s) => s.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('no such food: null', async () => {
    expect(await foodFacts(db, 999)).toBeNull()
  })
})

describe('labels, totals and typed grams', () => {
  it('labels read like a person says them', () => {
    expect(servingLabel({ measure_unit: 'undetermined', modifier: 'large', amount: 1 })).toBe('1 large')
    expect(servingLabel({ measure_unit: 'cup', modifier: '', amount: 1 })).toBe('1 cup')
    expect(servingLabel({ measure_unit: 'cup', modifier: ', chopped', amount: 0.5 })).toBe('0.5 cup, chopped')
    expect(servingLabel({ measure_unit: 'tbsp', modifier: 'tbsp, melted', amount: 1 })).toBe('1 tbsp, melted')
  })

  it('totals scale with the grams, rounded once', () => {
    const per100 = { kcal: 89, protein_g: 1.09, fat_g: 0.33, carbs_g: 22.84, fiber_g: null, sugar_g: null, sodium_mg: null }
    expect(amountTotals(per100, 236)).toEqual({ kcal: 210, protein_g: 2.6, carbs_g: 53.9, fat_g: 0.8 })
    expect(amountTotals(per100, 0).kcal).toBe(0)
  })

  it('typed grams: 1 to 5000, a comma works as a decimal point', () => {
    expect(parseGrams('118')).toBe(118)
    expect(parseGrams('12,5')).toBe(12.5)
    expect(parseGrams('0')).toBeNull()
    expect(parseGrams('abc')).toBeNull()
    expect(parseGrams('9000')).toBeNull()
  })
})
