import { beforeEach, describe, expect, it } from 'vitest'
import { NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { foodCount, foodDbSelfTest, searchFoods } from './food-search'

/**
 * Blind test round 1 (Nov 14 2026, B2): the Food Database never loaded and
 * "egg" found nothing. The cause was a build without the bundled database
 * (CI never built apps/mobile/assets/nutrition.db, and the optional require
 * in src/db/expo-adapter.ts let the bundle build without it). These tests
 * cover the search and the self-test line against a real SQLite database
 * with the app's schema; the CI simulator step runs the same self-test in
 * the built app, against the real bundled database.
 */

async function nutritionDb(foods: Array<[number, string, number]>): Promise<DbAdapter> {
  const db = openMemoryDb()
  await db.exec(NUTRITION_SCHEMA)
  await db.exec(NUTRITION_FTS_SCHEMA)
  for (const [id, name, kcal] of foods) {
    await db.run(
      `INSERT INTO foods (id, source, name, prep_facet, energy_kcal, barcode, popularity_rank,
                          license, basis_confidence, completeness_score)
       VALUES (?,?,?,NULL,?,NULL,?,'CC0','high',0.9)`,
      [id, 'fdc_sr_legacy', name, kcal, id],
    )
    await db.run('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)', [id, name, '', ''])
  }
  return db
}

describe('Food Database search', () => {
  let db: DbAdapter
  beforeEach(async () => {
    db = await nutritionDb([
      [1, 'Egg, whole, raw, fresh', 143],
      [2, 'Egg, whole, cooked, hard-boiled', 155],
      [3, 'Rice, white, long-grain, regular, cooked', 130],
    ])
  })

  it('"egg" finds eggs', async () => {
    const r = await searchFoods(db, 'egg')
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.outcome).not.toBe('none')
    for (const c of r.results) expect(c.name.toLowerCase()).toContain('egg')
  })

  it('a word with no food is "none", not an error', async () => {
    expect(await searchFoods(db, 'zzzzqqqx')).toEqual({ results: [], outcome: 'none' })
  })

  it('the self-test line: ok, with the food count and the matches for egg', async () => {
    expect(await foodCount(db)).toBe(3)
    const line = await foodDbSelfTest(db)
    expect(line).toMatch(/^food-db self-test: ok 3 foods, [1-9]\d* matches for egg \(first: Egg, /)
  })
})

describe('the self-test fails loudly', () => {
  it('on an empty database (the build without the bundled asset)', async () => {
    const db = await nutritionDb([])
    expect(await foodDbSelfTest(db)).toBe('food-db self-test: failed: the bundled food database is empty or missing')
  })

  it('on a database with no tables (what expo-sqlite opens when the import did not happen)', async () => {
    const db = openMemoryDb()
    expect(await foodCount(db)).toBe(0)
    expect(await foodDbSelfTest(db)).toMatch(/^food-db self-test: failed: /)
  })

  it('when no food matches egg', async () => {
    const db = await nutritionDb([[3, 'Rice, white, long-grain, regular, cooked', 130]])
    expect(await foodDbSelfTest(db)).toBe('food-db self-test: failed: no match for egg in 1 foods')
  })
})
