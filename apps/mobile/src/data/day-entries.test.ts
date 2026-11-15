import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { dayEntries, deleteEntry, setEntryGrams } from './day-entries'
import { logManualFood } from './manual-food'
import { localDate } from './date-utils'

/** Blind test round 2 (Nov 15 2026, N4): Home lists each entry, with its amount and kcal; change or delete one. */

const NOW = 1_763_200_000_000
let db: DbAdapter

const banana = { foodId: 1, displayName: 'Bananas, raw', grams: 118, nutrientSnapshot: { kcal: 89, protein_g: 1.09, fat_g: 0.33, carbs_g: 22.84, fiber_g: null, sugar_g: null, sodium_mg: null } }
const egg = { foodId: 2, displayName: 'Egg, whole, raw, fresh', grams: 50, nutrientSnapshot: { kcal: 143, protein_g: 12.56, fat_g: 9.51, carbs_g: 0.72, fiber_g: null, sugar_g: null, sodium_mg: null } }

beforeEach(async () => {
  db = openMemoryDb()
  await migrate(db, NOW)
})

describe('the entries of a day', () => {
  it('lists each entry with its name, grams and kcal, in the order logged', async () => {
    await logManualFood(db, banana, NOW)
    await logManualFood(db, egg, NOW + 60_000)
    expect(await dayEntries(db, localDate(NOW))).toMatchObject([
      { name: 'Bananas, raw', grams: 118, kcal: 105, isEstimate: false },
      { name: 'Egg, whole, raw, fresh', grams: 50, kcal: 72, isEstimate: false },
    ])
    expect(await dayEntries(db, '1999-01-01')).toEqual([])
  })

  it('a new amount changes the kcal; the snapshot stays per 100 g', async () => {
    await logManualFood(db, egg, NOW)
    const [e] = await dayEntries(db, localDate(NOW))
    await setEntryGrams(db, e!.itemId, 100)
    expect((await dayEntries(db, localDate(NOW)))[0]).toMatchObject({ grams: 100, kcal: 143 })
    await expect(setEntryGrams(db, e!.itemId, 0)).rejects.toThrow()
  })

  it('delete removes the entry, and its meal when nothing is left', async () => {
    await logManualFood(db, banana, NOW)
    const [e] = await dayEntries(db, localDate(NOW))
    await deleteEntry(db, e!.itemId)
    expect(await dayEntries(db, localDate(NOW))).toEqual([])
    expect(await db.get('SELECT id FROM meals WHERE id = ?', [e!.mealId])).toBeNull()
  })
})
