import type { DbAdapter } from '@nutai/db-adapter'

/**
 * The food log of one day, item by item, for Home (blind test round 2, Nov 15
 * 2026, N4: Home showed only "N meals logged"). Each entry is one log item:
 * its name, grams and kcal, with the same arithmetic as the day totals
 * (repo.ts dayTotals: per-100 g snapshot x grams / 100 x the portion eaten),
 * so the list and the ring always agree. The person can change the grams or
 * delete an entry.
 *
 * Pure: takes its DbAdapter (like manual-food.ts), so day-entries.test.ts runs
 * it in node against the app's real schema.
 */

export interface DayEntry {
  itemId: number
  mealId: number
  name: string
  grams: number
  /** Rounded once, here; the screen shows this number. */
  kcal: number
  /** An AI estimate (a photo or a described meal), not a database value. */
  isEstimate: boolean
  loggedAt: number
}

export async function dayEntries(h: DbAdapter, date: string): Promise<DayEntry[]> {
  const rows = await h.all<{
    id: number
    meal_id: number
    display_name: string
    grams: number
    kcal: number | null
    is_estimate: number
    logged_at: number
  }>(
    `SELECT li.id, li.meal_id, li.display_name, li.grams,
            li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction AS kcal,
            li.is_estimate, m.logged_at
       FROM log_items li JOIN meals m ON m.id = li.meal_id
      WHERE m.local_date = ? AND m.analysis_status IN ('complete','manual')
      ORDER BY m.logged_at, li.sort_order, li.id`,
    [date],
  )
  return rows.map((r) => ({
    itemId: Number(r.id),
    mealId: Number(r.meal_id),
    name: r.display_name,
    grams: r.grams,
    kcal: Math.round(r.kcal ?? 0),
    isEstimate: r.is_estimate === 1,
    loggedAt: r.logged_at,
  }))
}

/** A new amount for one entry. The per-100 g snapshot stays; the totals follow the grams. */
export async function setEntryGrams(h: DbAdapter, itemId: number, grams: number): Promise<void> {
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) throw new Error('grams out of range')
  await h.run('UPDATE log_items SET grams = ? WHERE id = ?', [grams, itemId])
}

/** Delete one entry; a meal with no entry left is deleted too. */
export async function deleteEntry(h: DbAdapter, itemId: number): Promise<void> {
  await h.transaction(async (tx) => {
    const row = await tx.get<{ meal_id: number }>('SELECT meal_id FROM log_items WHERE id = ?', [itemId])
    if (!row) return
    await tx.run('DELETE FROM log_items WHERE id = ?', [itemId])
    const left = await tx.get<{ c: number }>('SELECT COUNT(*) c FROM log_items WHERE meal_id = ?', [row.meal_id])
    if ((left?.c ?? 0) === 0) await tx.run('DELETE FROM meals WHERE id = ?', [row.meal_id])
  })
}
