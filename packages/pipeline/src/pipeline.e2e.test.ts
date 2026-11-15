import { beforeEach, describe, expect, it } from 'vitest'
import { SEEDED_BASELINES } from '@nutai/confidence'
import { SCHEMA_VERSION, type Item, type VisionPayload } from '@nutai/core-schema'
import { NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { PersonalPriors } from '@nutai/gram-engine'
import { recomputeTotals } from '@nutai/totals'
import { makeFoodDb, recomputeAfterEdit, runPipeline, validatePayload } from './index.js'

/**
 * END-TO-END: a model payload becomes a logged meal.
 *
 * Every one of the ten packages participates. The database is real SQLite with a
 * real FTS5 index. Nothing is mocked except the model call itself, which is the
 * one stage this pipeline deliberately does not own.
 */

const NOW = 1_753_900_000_000

function item(over: Partial<Item> = {}): Item {
  return {
    name: 'Grilled chicken breast',
    brand: null,
    canonical_food_key: 'chicken breast, grilled',
    food_form: 'flat',
    qualitative_size: 'medium',
    weight_basis: 'cooked',
    model_gram_estimate: 170,
    identification_confidence: 0.9,
    portion_confidence: 0.6,
    uncertainty_reason: 'none',
    visible_reference_objects: [],
    container: null,
    cooking_method_cues: ['grill_marks'],
    is_beverage: false,
    beverage_category: null,
    legible_label_text: null,
    stated_assumptions: [],
    clarifying_questions: [],
    fallback_macros_at_estimate: {
      calories_kcal: 280, protein_g: 53, carbs_g: 0, fat_g: 6, fiber_g: 0, sodium_mg: 130,
    },
    ...over,
  }
}

function payload(items: Item[]): VisionPayload {
  return {
    schema_version: SCHEMA_VERSION,
    is_food: true,
    refusal_reason: null,
    items,
    meal_overall: {
      identification_confidence: 0.9,
      portion_confidence: 0.6,
      assumptions: [],
      clarifying_questions: [],
    },
  }
}

const priors: PersonalPriors = { get: () => null, containers: new Map() }
const foodDb = makeFoodDb(new Map([['1', { medium: 172, per_unit: 172 }], ['3', { per_unit: 118 }]]))

let db: DbAdapter

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec(NUTRITION_SCHEMA)
  await db.exec(NUTRITION_FTS_SCHEMA)

  const rows: Array<[number, string, string, string | null, number, number, number, number, string | null]> = [
    [1, 'fdc_sr_legacy', 'Chicken, broilers or fryers, breast, meat only, cooked, grilled', 'grilled', 165, 31, 3.6, 0, null],
    [2, 'fdc_sr_legacy', 'Rice, white, long-grain, regular, cooked', 'boiled', 130, 2.7, 0.3, 28, null],
    [3, 'fdc_sr_legacy', 'Bananas, raw', 'raw', 89, 1.1, 0.3, 23, null],
    [4, 'fdc_branded', 'Chewy Granola Bar', null, 400, 6, 14, 62, '0012345678905'],
  ]
  for (const [id, source, name, prep, kcal, p, f, c, barcode] of rows) {
    await db.run(
      `INSERT INTO foods (id,source,name,prep_facet,energy_kcal,protein_g,fat_g,carb_g,barcode,
                          serving_size_g,license,basis_confidence,completeness_score,popularity_rank)
       VALUES (?,?,?,?,?,?,?,?,?,?,'CC0','high',0.95,?)`,
      [id, source, name, prep, kcal, p, f, c, barcode, barcode ? 40 : null, id * 10],
    )
    await db.run('INSERT INTO food_fts (rowid,name,brand,synonyms) VALUES (?,?,?,?)', [id, name, '', ''])
  }
})

const deps = () => ({ db, priors, baselines: SEEDED_BASELINES, path: 'cloud' as const, now: NOW })

describe('the happy path', () => {
  it('turns a photo payload into a logged meal with a real database row', async () => {
    const r = await runPipeline(payload([item()]), deps(), foodDb)
    expect(r).not.toBeNull()
    expect(r!.isFood).toBe(true)
    expect(r!.items).toHaveLength(1)

    const only = r!.items[0]!
    expect(only.resolution).not.toBe('miss')
    // The snapshot came from the DATABASE row, not the model's guess.
    expect(only.row.nutrientSnapshot.kcal).toBe(165)
    expect(only.row.isEstimate).toBe(false)
    expect(only.row.sourceFoodId).toBe('1')
  })

  it('shows the calories the food log will add, rounded once (blind test round 2, N3)', async () => {
    const r = await runPipeline(payload([item()]), deps(), foodDb)
    const saved = r!.meal.ingredients.reduce((s, row) => s + (row.nutrientSnapshot.kcal * row.grams) / 100, 0) * r!.meal.portionEatenFraction
    expect(r!.totals.kcal).toBe(Math.round(saved))
  })

  it('attaches an honest band, never a bare number', async () => {
    const r = await runPipeline(payload([item()]), deps(), foodDb)
    expect(r!.mealBand.halfPct).toBeGreaterThan(0)
    expect(r!.items[0]!.band.tier).toBeTruthy()
  })

  it('logs a banana in one tap with no highlighted question beyond the portion chip', async () => {
    const r = await runPipeline(
      payload([item({
        name: 'Banana', canonical_food_key: 'bananas, raw', food_form: 'discrete',
        qualitative_size: 'count:1', model_gram_estimate: 118, portion_confidence: 0.9,
        cooking_method_cues: ['none_visible'],
      })]),
      deps(), foodDb,
    )
    const highlighted = r!.questions.filter((q) => q.state === 'highlighted')
    expect(highlighted.length).toBeLessThanOrEqual(1)
  })
})

describe('the model never owns a number the user sees', () => {
  it('discards the model macros entirely when the database resolves', async () => {
    // The model claimed 280 kcal at 170 g. The database says 165 kcal/100 g.
    const r = await runPipeline(payload([item()]), deps(), foodDb)
    const row = r!.items[0]!.row
    const kcal = (row.nutrientSnapshot.kcal * row.grams) / 100
    // 165 * 1.72 = 283.8 from the DB pathway, not the model's flat 280.
    expect(row.nutrientSnapshot.kcal).toBe(165)
    expect(kcal).not.toBeCloseTo(280, 1)
  })

  it('never lets a 27-million-calorie payload reach the totals', async () => {
    const r = await runPipeline(
      payload([item({
        fallback_macros_at_estimate: {
          calories_kcal: 27_000_000, protein_g: 10, carbs_g: 15, fat_g: 28, fiber_g: 3, sodium_mg: 600,
        },
      })]),
      deps(), foodDb,
    )
    expect(r!.clampFlags.some((f) => f.kind === 'macro_arithmetic_mismatch')).toBe(true)
    expect(r!.totals.kcal).toBeLessThan(5000)
    expect(JSON.stringify(r!.totals)).not.toContain('27000000')
  })

  it('demotes an absurd gram estimate to the remaining ladder tiers', async () => {
    const r = await runPipeline(
      payload([item({ model_gram_estimate: 45_000 })]), deps(), foodDb,
    )
    expect(r!.clampFlags.some((f) => f.kind === 'grams_out_of_bounds')).toBe(true)
    expect(r!.items[0]!.row.grams).toBeLessThanOrEqual(3000)
  })
})

describe('the miss path is honest rather than silent', () => {
  it('flags an unresolvable food as an AI estimate and still logs it', async () => {
    const r = await runPipeline(
      payload([item({ name: 'Zorblax stew', canonical_food_key: 'zorblaxqq' })]),
      deps(), foodDb,
    )
    const only = r!.items[0]!
    expect(only.resolution).toBe('miss')
    expect(only.row.isEstimate).toBe(true)
    expect(r!.zeroHitCount).toBe(1)
    // It still produces a usable number from the model's fallback macros.
    expect(r!.totals.kcal).toBeGreaterThan(0)
  })

  it('converts the model’s at-estimate macros to a per-100g snapshot correctly', async () => {
    const r = await runPipeline(
      payload([item({
        canonical_food_key: 'zorblaxqq', model_gram_estimate: 200,
        fallback_macros_at_estimate: {
          calories_kcal: 400, protein_g: 20, carbs_g: 40, fat_g: 13.33, fiber_g: null, sodium_mg: null,
        },
      })]),
      deps(), foodDb,
    )
    const row = r!.items[0]!.row
    // 400 kcal at 200 g -> 200 kcal per 100 g.
    expect(row.nutrientSnapshot.kcal).toBeCloseTo(200, 1)
    // Round-trips back to the original absolute figure.
    expect((row.nutrientSnapshot.kcal * row.grams) / 100).toBeCloseTo(400, 1)
    // A null micronutrient stays null — never a fabricated zero.
    expect(row.nutrientSnapshot.fiber_g).toBeNull()
  })
})

describe('barcode short-circuit', () => {
  it('resolves deterministically and skips estimation entirely', async () => {
    const r = await runPipeline(
      payload([item({ name: 'Granola bar', canonical_food_key: 'granola bar', legible_label_text: 'Serving 40g' })]),
      { ...deps(), barcode: '012345678905' },
      foodDb,
    )
    const only = r!.items[0]!
    expect(only.resolution).toBe('barcode')
    expect(only.row.gramPathway).toBe('packaged_exact')
    expect(only.row.grams).toBe(40)
    expect(only.band.halfPct).toBeLessThan(0.05)
  })
})

describe('the oil correction moves fat, not just mass', () => {
  it('pushes a synthetic oil row so the fat macro actually changes', async () => {
    const plain = await runPipeline(
      payload([item({ canonical_food_key: 'zorblaxqq', cooking_method_cues: [] })]), deps(), foodDb,
    )
    const fried = await runPipeline(
      payload([item({ canonical_food_key: 'zorblaxqq', cooking_method_cues: ['deep_fried_color'] })]),
      deps(), foodDb,
    )
    expect(fried!.items.length).toBeGreaterThan(plain!.items.length)
    const oilRow = fried!.items.find((i) => i.row.origin === 'assumption_filler')
    expect(oilRow).toBeDefined()
    expect(fried!.totals.fat_g).toBeGreaterThan(plain!.totals.fat_g)
  })
})

describe('refusal', () => {
  it('returns a refusal without inventing items or calories', async () => {
    const r = await runPipeline(
      {
        schema_version: SCHEMA_VERSION, is_food: false,
        refusal_reason: 'This photo shows a dog, not food.',
        items: [], meal_overall: { identification_confidence: 0, portion_confidence: 0, assumptions: [], clarifying_questions: [] },
      },
      deps(), foodDb,
    )
    expect(r!.isFood).toBe(false)
    expect(r!.refusalReason).toMatch(/dog/)
    expect(r!.items).toHaveLength(0)
    expect(r!.totals.kcal).toBe(0)
  })

  it('rejects a structurally invalid payload rather than half-parsing it', async () => {
    expect(validatePayload({ nonsense: true })).toBeNull()
    expect(await runPipeline({ nonsense: true }, deps(), foodDb)).toBeNull()
  })
})

describe('the repair loop is free, local and instant', () => {
  it('recomputes totals after a gram edit with no database or network access', async () => {
    const r = await runPipeline(payload([item()]), deps(), foodDb)
    const meal = r!.meal
    const before = r!.totals.kcal

    // The user halves the portion. No await, no db, no fetch.
    const edited = {
      ...meal,
      ingredients: meal.ingredients.map((row) => ({ ...row, grams: row.grams / 2 })),
    }
    const after = recomputeAfterEdit(edited, r!.items.map((i) => i.band))
    expect(after.totals.kcal).toBeLessThan(before)
    expect(after.totals.kcal).toBeCloseTo(before / 2, -1)
  })

  it('applies portionEatenFraction as a final multiplier', async () => {
    const r = await runPipeline(payload([item()]), deps(), foodDb)
    const half = recomputeAfterEdit({ ...r!.meal, portionEatenFraction: 0.5 }, r!.items.map((i) => i.band))
    expect(half.totals.kcal).toBeCloseTo(r!.totals.kcal / 2, -1)
  })

  it('keeps totals equal to the sum of the visible rows after any edit', async () => {
    const r = await runPipeline(payload([item(), item({ name: 'Rice', canonical_food_key: 'rice, white, cooked' })]), deps(), foodDb)
    const meal = { ...r!.meal, ingredients: r!.meal.ingredients.filter((_, i) => i !== 0) }
    const totals = recomputeTotals(meal)
    const summed = meal.ingredients.reduce((s, row) => s + (row.nutrientSnapshot.kcal * row.grams) / 100, 0)
    expect(totals.kcal).toBeCloseTo(summed, 6)
  })
})

describe('multi-item meals', () => {
  it('resolves each item independently and compounds the band', async () => {
    const r = await runPipeline(
      payload([
        item(),
        item({ name: 'White rice', canonical_food_key: 'rice, white, cooked', food_form: 'piled', model_gram_estimate: 180 }),
      ]),
      deps(), foodDb,
    )
    expect(r!.items).toHaveLength(2)
    expect(r!.items[0]!.row.sourceFoodId).not.toBe(r!.items[1]!.row.sourceFoodId)
    expect(r!.mealBand.halfPct).toBeGreaterThan(0)
  })

  it('never highlights more than two questions across the whole meal', async () => {
    const messy = item({
      canonical_food_key: 'chicken stir fry with sauce',
      uncertainty_reason: 'oil_or_fat_not_visually_determinable',
      portion_confidence: 0.2,
    })
    const r = await runPipeline(payload([messy, messy, messy]), deps(), foodDb)
    expect(r!.questions.filter((q) => q.state === 'highlighted').length).toBeLessThanOrEqual(2)
  })
})
