import type { DbAdapter } from '@nutai/db-adapter'
import type { NutrientRow100g } from '@nutai/core-schema'
import { localDate, slotFor } from './date-utils'

/**
 * A food picked directly off the Food Database search screen — no photo, no
 * model call. `nutrientSnapshot` is the resolved row's real per-100 g values;
 * `logManualFood` copies them in at log time with the grams, exactly like
 * every other logging path (repo.ts logMeal), so a later corpus rebuild can
 * never move a historical log's numbers. The snap_* columns are PER 100 G:
 * the day totals multiply them by grams / 100.
 *
 * Blind test round 2 (Nov 15 2026, N4): this function stored the snapshot
 * already scaled to the grams, so the day totals scaled it a second time
 * ("Bananas, raw": 225 g of 89 kcal/100 g counted as 450 kcal).
 * fixScaledSearchSnapshots repairs the rows that older versions wrote.
 *
 * This takes its `DbAdapter` as a parameter rather than reaching for repo.ts's
 * cached app singleton — same shape as `backup-core.ts` — specifically so it
 * is testable under plain Node against `@nutai/db-adapter/node`'s
 * `openMemoryDb()`. The singleton's `db()` calls `openUserDb()` in
 * `apps/mobile/src/db/expo-adapter.ts`, which imports `expo-sqlite`; that
 * import throws under Node, so any function that hard-codes it can only ever
 * be exercised inside a running app, never in this test suite.
 */
export interface ManualFoodSelection {
  foodId: number
  displayName: string
  grams: number
  nutrientSnapshot: NutrientRow100g
}

export async function logManualFood(h: DbAdapter, selection: ManualFoodSelection, now: number): Promise<number> {
  const date = localDate(now)
  const n = selection.nutrientSnapshot
  const per100 = (v: number | null | undefined) => (v == null ? null : v)

  return h.transaction(async (tx) => {
    const meal = await tx.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at)
       VALUES (?,?,?,1.0,'complete',?)`,
      [now, date, slotFor(now), now],
    )
    const mealId = Number(meal.lastInsertRowId)

    await tx.run(
      `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, display_name, grams,
                              gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g,
                              snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                              is_estimate, macros_user_edited, sort_order, logged_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`,
      [
        mealId,
        selection.foodId,
        'corpus',
        selection.displayName,
        selection.grams,
        'fndds_standard_portion',
        'db_search',
        per100(n.kcal),
        per100(n.protein_g),
        per100(n.fat_g),
        per100(n.carbs_g),
        per100(n.fiber_g),
        per100(n.sugar_g),
        per100(n.sodium_mg),
        now,
      ],
    )

    return mealId
  })
}

/** The settings key that marks the repair below as done. */
export const SEARCH_SNAPSHOT_FIX_KEY = 'fix.db_search_per100.v1'

/**
 * Repair the Food Database rows that versions up to 0.1.8 wrote: their
 * snapshot was already scaled to the grams (see above). Divide it back to per
 * 100 g, once per phone (SEARCH_SNAPSHOT_FIX_KEY); rows written after the
 * repair are never touched. Returns the number of rows repaired.
 */
export async function fixScaledSearchSnapshots(h: DbAdapter): Promise<number> {
  const done = await h.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SEARCH_SNAPSHOT_FIX_KEY])
  if (done) return 0
  return h.transaction(async (tx) => {
    const r = await tx.run(
      `UPDATE log_items SET
         snap_energy_kcal = snap_energy_kcal * 100.0 / grams,
         snap_protein_g   = snap_protein_g   * 100.0 / grams,
         snap_fat_g       = snap_fat_g       * 100.0 / grams,
         snap_carb_g      = snap_carb_g      * 100.0 / grams,
         snap_fiber_g     = snap_fiber_g     * 100.0 / grams,
         snap_sugar_g     = snap_sugar_g     * 100.0 / grams,
         snap_sodium_mg   = snap_sodium_mg   * 100.0 / grams
       WHERE portion_source = 'db_search' AND grams > 0`,
    )
    await tx.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [SEARCH_SNAPSHOT_FIX_KEY, String(Date.now())])
    return Number(r.changes ?? 0)
  })
}
