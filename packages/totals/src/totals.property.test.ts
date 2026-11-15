import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import { recomputeTotals, rowTotals, toDisplayTotals } from './index.js'

/**
 * Property test 1 of 3 (SPEC-accuracy-engine.md §8.2 / PLAN.md §8.2):
 *
 *   For ANY ingredient list, after ANY sequence of add / remove / edit-grams /
 *   set-fraction operations, the displayed total equals
 *   Σ(grams/100 × per-100g) × portionEatenFraction.
 *
 * This is the invariant the app we are replacing shipped broken — editing protein
 * from 226 g to 175 g left calories sitting at 2,964 kcal, unchanged. A
 * single-example unit test would not have caught it either, because the bug only
 * appears after a specific *sequence* of operations. Generating the sequences is
 * the point.
 */

const arbNutrients = fc.record({
  kcal: fc.double({ min: 0, max: 900, noNaN: true }),
  protein_g: fc.double({ min: 0, max: 100, noNaN: true }),
  fat_g: fc.double({ min: 0, max: 100, noNaN: true }),
  carbs_g: fc.double({ min: 0, max: 100, noNaN: true }),
  fiber_g: fc.oneof(fc.double({ min: 0, max: 50, noNaN: true }), fc.constant(null)),
  sodium_mg: fc.oneof(fc.double({ min: 0, max: 5000, noNaN: true }), fc.constant(null)),
})

const arbRow = (id: number): fc.Arbitrary<IngredientRow> =>
  fc.record({
    grams: fc.double({ min: 0.1, max: 3000, noNaN: true }),
    nutrientSnapshot: arbNutrients,
  }).map(({ grams, nutrientSnapshot }) => ({
    id: `row-${id}`,
    displayName: `Food ${id}`,
    sourceFoodId: null,
    grams,
    nutrientSnapshot,
    origin: 'vision_model' as const,
    gramPathway: 'model_guess' as const,
    bandHalfPct: 0.3,
    isEstimate: false,
    assumptions: [],
  }))

const arbRows = fc
  .array(fc.nat({ max: 1000 }), { minLength: 0, maxLength: 12 })
  .chain((ids) => fc.tuple(...ids.map((_, i) => arbRow(i))))

/** The operations a user can actually perform in the repair loop. */
type Op =
  | { kind: 'addRow'; row: IngredientRow }
  | { kind: 'removeRow'; index: number }
  | { kind: 'editGrams'; index: number; grams: number }
  | { kind: 'setFraction'; fraction: number }

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  arbRow(999).map((row) => ({ kind: 'addRow' as const, row })),
  fc.nat({ max: 20 }).map((index) => ({ kind: 'removeRow' as const, index })),
  fc
    .tuple(fc.nat({ max: 20 }), fc.double({ min: 0.1, max: 3000, noNaN: true }))
    .map(([index, grams]) => ({ kind: 'editGrams' as const, index, grams })),
  fc
    .double({ min: 0, max: 1, noNaN: true })
    .map((fraction) => ({ kind: 'setFraction' as const, fraction })),
)

function applyOp(meal: LoggedMeal, op: Op): LoggedMeal {
  switch (op.kind) {
    case 'addRow':
      return { ...meal, ingredients: [...meal.ingredients, op.row] }
    case 'removeRow': {
      if (meal.ingredients.length === 0) return meal
      const i = op.index % meal.ingredients.length
      return { ...meal, ingredients: meal.ingredients.filter((_, idx) => idx !== i) }
    }
    case 'editGrams': {
      if (meal.ingredients.length === 0) return meal
      const i = op.index % meal.ingredients.length
      return {
        ...meal,
        ingredients: meal.ingredients.map((r, idx) =>
          idx === i ? { ...r, grams: op.grams } : r,
        ),
      }
    }
    case 'setFraction':
      return { ...meal, portionEatenFraction: op.fraction }
  }
}

function emptyMeal(ingredients: IngredientRow[]): LoggedMeal {
  return {
    id: 'meal-1',
    loggedAt: '2026-07-31T12:00:00.000Z',
    ingredients,
    portionEatenFraction: 1,
    engineId: 'test',
    promptVersion: null,
    schemaVersion: null,
    clampFlags: [],
  }
}

/** Independent re-derivation of the invariant. Deliberately not the implementation. */
function expectedTotals(meal: LoggedMeal) {
  let kcal = 0
  let protein = 0
  let fat = 0
  let carbs = 0
  for (const r of meal.ingredients) {
    const f = r.grams / 100
    kcal += r.nutrientSnapshot.kcal * f
    protein += r.nutrientSnapshot.protein_g * f
    fat += r.nutrientSnapshot.fat_g * f
    carbs += r.nutrientSnapshot.carbs_g * f
  }
  const p = meal.portionEatenFraction
  return { kcal: kcal * p, protein_g: protein * p, fat_g: fat * p, carbs_g: carbs * p }
}

/** Floats accumulate; compare relatively, not exactly. */
function closeEnough(actual: number, expected: number): boolean {
  const scale = Math.max(1, Math.abs(expected))
  return Math.abs(actual - expected) / scale < 1e-9
}

describe('totals reconciliation property', () => {
  it('holds for any sequence of repair-loop operations', () => {
    fc.assert(
      fc.property(arbRows, fc.array(arbOp, { maxLength: 30 }), (rows, ops) => {
        const meal = ops.reduce(applyOp, emptyMeal(rows))
        const actual = recomputeTotals(meal)
        const expected = expectedTotals(meal)

        expect(closeEnough(actual.kcal, expected.kcal)).toBe(true)
        expect(closeEnough(actual.protein_g, expected.protein_g)).toBe(true)
        expect(closeEnough(actual.fat_g, expected.fat_g)).toBe(true)
        expect(closeEnough(actual.carbs_g, expected.carbs_g)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('always equals the sum of its own per-row contributions', () => {
    // The user-facing form of the invariant: the total shown at the top of the
    // result screen must equal the sum of the rows shown beneath it.
    fc.assert(
      fc.property(arbRows, (rows) => {
        const meal = emptyMeal(rows)
        const total = recomputeTotals(meal)
        const summed = rows.reduce((acc, r) => acc + rowTotals(r).kcal, 0)
        expect(closeEnough(total.kcal, summed)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('scales linearly in portionEatenFraction', () => {
    fc.assert(
      fc.property(arbRows, fc.double({ min: 0, max: 1, noNaN: true }), (rows, fraction) => {
        const full = recomputeTotals(emptyMeal(rows))
        const part = recomputeTotals({ ...emptyMeal(rows), portionEatenFraction: fraction })
        expect(closeEnough(part.kcal, full.kcal * fraction)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('is order-independent — the same rows in any order give the same total', () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const a = recomputeTotals(emptyMeal(rows))
        const b = recomputeTotals(emptyMeal([...rows].reverse()))
        // Float addition is not associative, so compare at display precision —
        // which is the precision a user can actually observe.
        expect(Math.round(a.kcal)).toBe(Math.round(b.kcal))
      }),
      { numRuns: 300 },
    )
  })

  it('displayed calories are the energy the food log adds, rounded once (blind test round 2, N3)', () => {
    // The day totals sum snapshot energy x grams / 100 x the portion eaten.
    // The shown number is that sum, rounded once: one value shown and saved.
    fc.assert(
      fc.property(arbRows, (rows) => {
        const meal = emptyMeal(rows)
        const d = toDisplayTotals(recomputeTotals(meal))
        const saved = meal.ingredients.reduce((s, r) => s + (r.nutrientSnapshot.kcal * r.grams) / 100, 0) * meal.portionEatenFraction
        expect(Math.abs(d.kcal - saved)).toBeLessThanOrEqual(0.5 + 1e-6)
      }),
      { numRuns: 300 },
    )
  })

  it('an empty meal is zero, not NaN', () => {
    const t = recomputeTotals(emptyMeal([]))
    expect(t).toEqual({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 })
  })
})
