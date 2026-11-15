import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { ScoredCandidate } from '@nutai/resolver'
import { resolveSelection } from './food-search-select'
import { logManualFood } from './manual-food'

/**
 * Regression coverage for "tap a candidate row in Food Database and nothing
 * happens" (bug tracker: 9016cdb8, 47c9cc17). Root cause was in
 * food-search.tsx: search results were rendered as a plain `View` with no
 * `onPress` at all — introduced that way in f95a17c when the screen moved
 * into the FAB sheet, never wired since. No tap could ever fire a selection.
 *
 * There is no React Native component-render harness in this repo (vitest
 * here runs under `environment: 'node'`, and `apps/mobile/app/**` is not
 * part of the test glob in vitest.config.ts — see that file). packages/* and
 * the app's data layer are pure-logic-testable by design; screens are not,
 * and none of the app's other 30+ screens have a component-render test
 * either. So this covers the exact logic the row's `onPress` now runs —
 * `resolveSelection` (reads the tapped candidate's grams + snapshot from the
 * nutrition corpus) and `logManualFood` (writes it to today's log) — against
 * real in-memory SQLite databases running the app's real schema. What is
 * NOT exercised here is the JSX wiring itself (that `onPress` is actually
 * attached to the row and calls `handleSelect`); `apps/mobile`'s
 * `npm run typecheck` passing confirms the wiring compiles, but a `.tsx`
 * render+press test would need new test infra (react-test-renderer or
 * @testing-library/react-native, plus mocks for expo-router/expo-sqlite/
 * safe-area-context) — flagged as an explicit gap rather than skipped
 * silently.
 */

const NOW = 1_754_200_000_000

let userDb: DbAdapter
let nutritionDb: DbAdapter

beforeEach(async () => {
  userDb = openMemoryDb()
  await userDb.exec('PRAGMA foreign_keys = ON;')
  await migrate(userDb, NOW)

  nutritionDb = openMemoryDb()
  await nutritionDb.exec(NUTRITION_SCHEMA)
  await nutritionDb.run(
    `INSERT INTO foods (id, source, source_id, name, energy_kcal, protein_g, fat_g, carb_g, fiber_g,
                        sugar_g, sodium_mg, completeness_score, license, updated_at)
     VALUES (1, 'fdc_sr_legacy', '173424', 'Egg, whole, raw, fresh', 143, 12.6, 9.5, 0.72, 0, 0.37, 142, 1, 'CC0', ?)`,
    [NOW],
  )
  await nutritionDb.run(
    `INSERT INTO food_portions (food_id, measure_unit, modifier, amount, gram_weight, is_fndds_default)
     VALUES (1, 'undetermined', 'large', 1, 50, 1)`,
  )
})

function candidateFor(foodId: string, name: string, energyKcal: number): ScoredCandidate {
  return {
    foodId,
    name,
    brand: null,
    category: null,
    prepFacet: null,
    basisConfidence: 'high',
    servingSizeG: null,
    energyKcal,
    popularityRank: null,
    completenessScore: 1,
    rawBm25: -1,
    score: 0.9,
    breakdown: {},
  }
}

describe('resolveSelection + logManualFood — what a tap on a Food Database row does', () => {
  it('fires a real selection: a tap logs the food to today, not nothing', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('1', 'Egg, whole, raw, fresh', 143))
    const mealId = await logManualFood(userDb, selection, NOW)

    expect(mealId).toBeGreaterThan(0)
    const items = await userDb.all<{ matched_food_id: number; display_name: string; grams: number }>(
      'SELECT matched_food_id, display_name, grams FROM log_items WHERE meal_id = ?',
      [mealId],
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.matched_food_id).toBe(1)
    expect(items[0]?.display_name).toBe('Egg, whole, raw, fresh')
  })

  it('uses the FNDDS default portion weight, not a hardcoded 100 g', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('1', 'Egg, whole, raw, fresh', 143))
    expect(selection.grams).toBe(50) // the seeded is_fndds_default row, not the 100 g fallback
  })

  // Blind test round 2 (Nov 15 2026, N4): this test used to expect the
  // snapshot SCALED to the grams (71.5 kcal), which the day totals then scaled
  // a second time (one egg counted as 36 kcal; a banana as 450). The snapshot
  // is per 100 g, like every other log path; the day total is 71.5 kcal.
  it('stores the per-100 g snapshot, and the day total for 50 g of a 143 kcal/100 g egg is 71.5 kcal', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('1', 'Egg, whole, raw, fresh', 143))
    const mealId = await logManualFood(userDb, selection, NOW)

    const item = await userDb.get<{ snap_energy_kcal: number; snap_protein_g: number; grams: number }>(
      'SELECT snap_energy_kcal, snap_protein_g, grams FROM log_items WHERE meal_id = ?',
      [mealId],
    )
    expect(item?.snap_energy_kcal).toBeCloseTo(143, 5)
    expect(item?.snap_protein_g).toBeCloseTo(12.6, 5)
    const total = await userDb.get<{ kcal: number }>(
      `SELECT SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal
         FROM meals m JOIN log_items li ON li.meal_id = m.id WHERE m.id = ?`,
      [mealId],
    )
    expect(total?.kcal).toBeCloseTo(71.5, 5)
  })

  it('repairs the rows older versions scaled twice, once', async () => {
    const { fixScaledSearchSnapshots, SEARCH_SNAPSHOT_FIX_KEY } = await import('./manual-food')
    const selection = await resolveSelection(nutritionDb, candidateFor('1', 'Egg, whole, raw, fresh', 143))
    const mealId = await logManualFood(userDb, selection, NOW)
    // What 0.1.8 stored: the snapshot already scaled to 50 g.
    await userDb.run('UPDATE log_items SET snap_energy_kcal = 71.5, snap_protein_g = 6.3 WHERE meal_id = ?', [mealId])
    expect(await fixScaledSearchSnapshots(userDb)).toBe(1)
    const fixed = await userDb.get<{ snap_energy_kcal: number }>('SELECT snap_energy_kcal FROM log_items WHERE meal_id = ?', [mealId])
    expect(fixed?.snap_energy_kcal).toBeCloseTo(143, 5)
    // Done once: a second run changes nothing.
    expect(await fixScaledSearchSnapshots(userDb)).toBe(0)
    expect(await userDb.get('SELECT value FROM settings WHERE key = ?', [SEARCH_SNAPSHOT_FIX_KEY])).not.toBeNull()
  })

  it('falls back to 100 g when the corpus row has no portion data at all', async () => {
    await nutritionDb.run(
      `INSERT INTO foods (id, source, source_id, name, energy_kcal, protein_g, fat_g, carb_g,
                          completeness_score, license, updated_at)
       VALUES (2, 'fdc_sr_legacy', '999', 'Mystery food, no portions', 200, 10, 5, 20, 1, 'CC0', ?)`,
      [NOW],
    )
    const selection = await resolveSelection(nutritionDb, candidateFor('2', 'Mystery food, no portions', 200))
    expect(selection.grams).toBe(100)
  })

  it('two selections create two separate meals, not one overwritten row', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('1', 'Egg, whole, raw, fresh', 143))
    const first = await logManualFood(userDb, selection, NOW)
    const second = await logManualFood(userDb, selection, NOW + 1000)
    expect(first).not.toBe(second)

    const items = await userDb.all('SELECT id FROM log_items')
    expect(items).toHaveLength(2)
  })
})
