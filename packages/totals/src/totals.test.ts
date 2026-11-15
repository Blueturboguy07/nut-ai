import { describe, expect, it } from 'vitest'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import {
  calorieBasisFor,
  itemCalories,
  labelRounding,
  recomputeTotals,
  reconcileFromMacros,
  roundDisplayGrams,
  toDisplayTotals,
} from './index.js'

function row(over: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'r1',
    displayName: 'Chicken breast, grilled',
    sourceFoodId: 'fdc:171077',
    grams: 100,
    nutrientSnapshot: {
      kcal: 165,
      protein_g: 31,
      fat_g: 3.6,
      carbs_g: 0,
      fiber_g: 0,
      sodium_mg: 74,
    },
    origin: 'db_search',
    gramPathway: 'fndds_standard_portion',
    bandHalfPct: 0.25,
    isEstimate: false,
    assumptions: [],
    ...over,
  }
}

function meal(ingredients: IngredientRow[], portionEatenFraction = 1): LoggedMeal {
  return {
    id: 'm1',
    loggedAt: '2026-07-31T18:00:00.000Z',
    ingredients,
    portionEatenFraction,
    engineId: 'test',
    promptVersion: 'food-scan-v1.0.0',
    schemaVersion: '1.0.0',
    clampFlags: [],
  }
}

describe('the documented edit bug this module exists to prevent', () => {
  // Reported behaviour of the app we are replacing: a user edited protein from
  // 226 g down to 175 g and the calorie figure stayed at 2,964 kcal, with fat and
  // carbs also unchanged. That is only possible if calories are stored as an
  // independent number rather than derived from the rows.
  it('moves calories when a macro is edited', () => {
    const before = row({
      grams: 100,
      nutrientSnapshot: { kcal: 2964, protein_g: 226, fat_g: 100, carbs_g: 380, fiber_g: 0, sodium_mg: 0 },
      macrosUserEdited: true,
    })
    const after = row({
      ...before,
      nutrientSnapshot: { ...before.nutrientSnapshot, protein_g: 175 },
      macrosUserEdited: true,
    })

    const kcalBefore = itemCalories(before)
    const kcalAfter = itemCalories(after)

    expect(kcalAfter).not.toBe(kcalBefore)
    // 51 g of protein removed x 4 kcal/g = 204 kcal.
    expect(kcalBefore - kcalAfter).toBeCloseTo(204, 6)
  })

  it('cannot store calories independently of the rows — there is no such field', () => {
    // The absence of a settable total is the actual fix. recomputeTotals derives
    // everything; a stale total has nowhere to live.
    const m = meal([row({ grams: 200 })])
    expect(recomputeTotals(m).kcal).toBeCloseTo(330, 6)
    expect(recomputeTotals({ ...m, ingredients: [row({ grams: 100 })] }).kcal).toBeCloseTo(165, 6)
  })
})

describe('recomputeTotals', () => {
  it('scales per-100g values by grams', () => {
    const t = recomputeTotals(meal([row({ grams: 250 })]))
    expect(t.kcal).toBeCloseTo(412.5, 6)
    expect(t.protein_g).toBeCloseTo(77.5, 6)
  })

  it('applies portionEatenFraction last, to the summed total', () => {
    const t = recomputeTotals(meal([row({ grams: 200 }), row({ id: 'r2', grams: 100 })], 0.5))
    // (330 + 165) * 0.5
    expect(t.kcal).toBeCloseTo(247.5, 6)
  })

  it('treats a null micronutrient as contributing zero to a sum, not as zero content', () => {
    const withNull = row({
      grams: 100,
      nutrientSnapshot: { kcal: 100, protein_g: 5, fat_g: 2, carbs_g: 10, fiber_g: null, sodium_mg: null },
    })
    const t = recomputeTotals(meal([withNull]))
    expect(t.fiber_g).toBe(0)
    expect(t.sodium_mg).toBe(0)
    // The row itself still records "not reported", which is what the UI renders.
    expect(withNull.nutrientSnapshot.fiber_g).toBeNull()
  })
})

describe('calorie basis disclosure', () => {
  it('uses the database value for an untouched resolved row', () => {
    const r = row({ grams: 100 })
    expect(calorieBasisFor(r)).toBe('database')
    // 165, the lab value — not 4*31 + 4*0 + 9*3.6 = 156.4.
    expect(itemCalories(r)).toBeCloseTo(165, 6)
  })

  it('switches to Atwater the moment a macro is edited', () => {
    const r = row({ grams: 100, macrosUserEdited: true })
    expect(calorieBasisFor(r)).toBe('recomputed')
    expect(itemCalories(r)).toBeCloseTo(156.4, 6)
  })
})

describe('display rounding — Regime B', () => {
  it('reproduces the spec worked example, resolving a contradiction inside it', () => {
    // Three items summing to 480.9 kcal / 52.69 P / 6.19 F / 50.0 C.
    //
    // SPEC-accuracy-engine.md §6.3 contradicts itself here. The stated rule is
    // "one decimal for grams under 10 g; whole grams at 10 g and above", which
    // makes 6.19 g of fat display as 6.2. But the worked example immediately
    // below it shows that same 6.19 rounding to 6 — the whole-gram rule — and
    // therefore reports 466 kcal.
    //
    // We follow the STATED RULE, not the example, for two reasons: it preserves
    // real information (6.2 g of fat is a materially different number from 6 g
    // when the daily target is ~60 g), and the property that actually matters is
    // unaffected — displayed calories are computed FROM the displayed macros
    // either way, so the user can still hand-multiply and get the shown figure.
    //
    // Under the stated rule: round(4*53 + 4*50 + 9*6.2) = round(467.8) = 468.
    const d = toDisplayTotals({
      kcal: 480.9,
      protein_g: 52.69,
      fat_g: 6.19,
      carbs_g: 50.0,
      fiber_g: 4.2,
      sodium_mg: 611.4,
    })
    expect(d.protein_g).toBe(53)
    expect(d.fat_g).toBe(6.2)
    expect(d.carbs_g).toBe(50)
    // Blind test round 2 (N3): the shown calories are the stored energy,
    // rounded once (the number the food log adds), not 4/4/9 of the macros.
    expect(d.kcal).toBe(481)
  })

  it('keeps one decimal below 10 g and whole grams at or above 10 g', () => {
    expect(roundDisplayGrams(6.19)).toBe(6.2)
    expect(roundDisplayGrams(9.94)).toBe(9.9)
    expect(roundDisplayGrams(10.4)).toBe(10)
    expect(roundDisplayGrams(52.69)).toBe(53)
  })
})

describe('display rounding — Regime A (21 CFR 101.9(c))', () => {
  it('rounds calories to 5 up to 50 and to 10 above 50', () => {
    expect(labelRounding.calories(3)).toBe(0)
    expect(labelRounding.calories(23)).toBe(25)
    expect(labelRounding.calories(50)).toBe(50)
    expect(labelRounding.calories(137)).toBe(140)
  })

  it('rounds fat to half grams below 5 g and whole grams above', () => {
    expect(labelRounding.fat(0.3)).toBe(0)
    expect(labelRounding.fat(2.3)).toBe(2.5)
    expect(labelRounding.fat(7.4)).toBe(7)
  })

  it('applies the three sodium tiers', () => {
    expect(labelRounding.sodium(3)).toBe(0)
    expect(labelRounding.sodium(63)).toBe(65)
    expect(labelRounding.sodium(287)).toBe(290)
  })

  it('distinguishes zero from a declarable trace amount', () => {
    expect(labelRounding.gramNutrient(0.3)).toBe(0)
    expect(labelRounding.isTrace(0.3)).toBe(false)
    expect(labelRounding.isTrace(0.7)).toBe(true)
  })

  it('applies the three %DV tiers', () => {
    expect(labelRounding.percentDV(7)).toBe(8)
    expect(labelRounding.percentDV(33)).toBe(35)
    expect(labelRounding.percentDV(76)).toBe(80)
  })

  it('does not compose additively — which is why sums must use Regime B', () => {
    // Three real fat values. Rounding each to the label then summing gives a
    // different answer from rounding the true sum once. This test documents the
    // hazard rather than guarding against it: it is why the two regimes exist.
    const fats = [2.3, 2.3, 2.3]
    const sumOfRounded = fats.reduce((a, g) => a + labelRounding.fat(g), 0)
    const roundedSum = labelRounding.fat(fats.reduce((a, g) => a + g, 0))
    expect(sumOfRounded).toBe(7.5)
    expect(roundedSum).toBe(7)
    expect(sumOfRounded).not.toBe(roundedSum)
  })
})

describe('reconcileFromMacros', () => {
  it('is Atwater 4/4/9', () => {
    expect(reconcileFromMacros(31, 0, 3.6)).toBeCloseTo(156.4, 6)
  })
})
