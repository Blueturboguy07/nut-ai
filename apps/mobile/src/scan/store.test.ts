import { beforeEach, describe, expect, it } from 'vitest'
import type { Band } from '@nutai/confidence'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import { recomputeAfterEdit } from '@nutai/pipeline'
import type { ScanResult } from '@nutai/pipeline'
import {
  applyWebOption,
  editGrams,
  getPhase,
  removeRow,
  reset,
  setPhase,
  setPortionEaten,
  setWebLookup,
} from './store'

/**
 * The scan store's arithmetic — the numbers the user actually edits.
 *
 * Every mutation must recompute locally and keep the invariant that displayed
 * calories are reproducible from displayed macros. applyWebOption gets the
 * hardest scrutiny: it converts PER-SERVING published values into a per-100g
 * snapshot, and an error there mislabels every branded food in the app.
 */

function row(over: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'r1',
    displayName: 'Grilled chicken breast',
    sourceFoodId: '1',
    grams: 170,
    nutrientSnapshot: { kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 74 },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion' as IngredientRow['gramPathway'],
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
    ...over,
  }
}

function readyWith(rows: IngredientRow[]): void {
  const meal: LoggedMeal = {
    id: 'm1',
    loggedAt: '2026-08-01T12:00:00Z',
    ingredients: rows,
    portionEatenFraction: 1,
    engineId: 'test',
    promptVersion: null,
    schemaVersion: null,
    clampFlags: [],
  }
  const bands: Band[] = rows.map((r) => ({ halfPct: r.bandHalfPct, tier: 'moderate', reasons: [] }))
  const { totals, mealBand } = recomputeAfterEdit(meal, bands)
  const result: ScanResult = {
    isFood: true,
    refusalReason: null,
    items: rows.map((r, i) => ({ row: r, band: bands[i]!, resolution: 'auto_accept', gramPathway: r.gramPathway })),
    meal,
    totals,
    mealBand,
    questions: [],
    clampFlags: [],
    zeroHitCount: 0,
  }
  setPhase({ kind: 'ready', photoUri: null, result, bands, meta: null, webLookups: {} })
}

const readyPhase = () => {
  const p = getPhase()
  if (p.kind !== 'ready') throw new Error(`expected ready, got ${p.kind}`)
  return p
}

beforeEach(() => reset())

describe('editGrams', () => {
  it('scales totals linearly and instantly', () => {
    readyWith([row()])
    const before = readyPhase().result.totals.kcal
    editGrams('r1', 340)
    const after = readyPhase().result.totals.kcal
    expect(after).toBeGreaterThan(before * 1.8)
    expect(after).toBeLessThan(before * 2.2)
  })

  it('ignores garbage input rather than corrupting the row', () => {
    readyWith([row()])
    const before = readyPhase().result.totals.kcal
    editGrams('r1', Number.NaN)
    editGrams('r1', -50)
    expect(readyPhase().result.totals.kcal).toBe(before)
  })
})

describe('removeRow', () => {
  it('drops the row and its contribution', () => {
    readyWith([row(), row({ id: 'r2', displayName: 'Rice', nutrientSnapshot: { kcal: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28, fiber_g: 0, sugar_g: 0, sodium_mg: 1 }, grams: 180 })])
    removeRow('r2')
    const p = readyPhase()
    expect(p.result.meal.ingredients).toHaveLength(1)
    expect(p.result.totals.kcal).toBeLessThan(300)
  })
})

describe('setPortionEaten', () => {
  it('applies as a final multiplier and clamps to [0,1]', () => {
    readyWith([row()])
    const full = readyPhase().result.totals.kcal
    setPortionEaten(0.5)
    const half = readyPhase().result.totals.kcal
    expect(half).toBeGreaterThan(full * 0.4)
    expect(half).toBeLessThan(full * 0.6)

    setPortionEaten(7)
    expect(readyPhase().result.meal.portionEatenFraction).toBe(1)
  })
})

describe('applyWebOption — per-serving to per-100g', () => {
  const option = {
    label: 'Spicy Chicken Sandwich',
    serving_g: 232,
    serving_desc: '1 sandwich (232 g)',
    calories_kcal: 450,
    protein_g: 28,
    carbs_g: 45,
    fat_g: 19,
    fiber_g: 3,
    sodium_mg: 1650,
  }

  it('round-trips: snapshot x grams / 100 recovers the published per-serving values', () => {
    readyWith([row({ isEstimate: true, sourceFoodId: null })])
    applyWebOption('r1', option, 'https://www.chick-fil-a.com/nutrition')

    const r = readyPhase().result.meal.ingredients[0]!
    expect(r.grams).toBe(232)
    expect((r.nutrientSnapshot.kcal * r.grams) / 100).toBeCloseTo(450, 6)
    expect((r.nutrientSnapshot.protein_g * r.grams) / 100).toBeCloseTo(28, 6)
    expect((r.nutrientSnapshot.sodium_mg! * r.grams) / 100).toBeCloseTo(1650, 6)
  })

  it('upgrades provenance: cited web row, no longer an AI estimate', () => {
    readyWith([row({ isEstimate: true, sourceFoodId: null })])
    applyWebOption('r1', option, 'https://www.chick-fil-a.com/nutrition')
    const r = readyPhase().result.meal.ingredients[0]!
    expect(r.origin).toBe('web_lookup')
    expect(r.isEstimate).toBe(false)
    expect(r.sourceUrl).toContain('chick-fil-a.com')
    expect(r.displayName).toBe('Spicy Chicken Sandwich')
  })

  it('keeps the current grams when the source lists no serving weight', () => {
    readyWith([row({ grams: 200 })])
    applyWebOption('r1', { ...option, serving_g: null }, null)
    const r = readyPhase().result.meal.ingredients[0]!
    expect(r.grams).toBe(200)
    // The per-serving values are then spread over those 200 g.
    expect((r.nutrientSnapshot.kcal * r.grams) / 100).toBeCloseTo(450, 6)
  })

  it('a nutrient the source does not list stays null — never a fabricated zero', () => {
    readyWith([row()])
    applyWebOption('r1', { ...option, fiber_g: null, sodium_mg: null }, null)
    const r = readyPhase().result.meal.ingredients[0]!
    expect(r.nutrientSnapshot.fiber_g).toBeNull()
    expect(r.nutrientSnapshot.sodium_mg).toBeNull()
  })
})

describe('setWebLookup', () => {
  it('attaches per-row lookup state on the ready phase only', () => {
    setWebLookup('r1', { status: 'running' })
    expect(getPhase().kind).toBe('idle')

    readyWith([row()])
    setWebLookup('r1', { status: 'running' })
    expect(readyPhase().webLookups['r1']).toEqual({ status: 'running' })
  })
})

describe('a failed phase', () => {
  it('carries its one action link through setPhase/getPhase', () => {
    setPhase({
      kind: 'failed',
      photoUri: 'p',
      message: 'Not enough publik credit for this request.',
      canRetry: false,
      failureKind: 'quota-exhausted',
      action: { label: 'Link this phone & pick a plan', url: 'https://publikhq.com/claim/AB' },
    })
    const p = getPhase()
    expect(p.kind).toBe('failed')
    if (p.kind === 'failed') expect(p.action).toEqual({ label: 'Link this phone & pick a plan', url: 'https://publikhq.com/claim/AB' })
  })
})
