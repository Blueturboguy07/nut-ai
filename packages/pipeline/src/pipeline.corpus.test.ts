import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEEDED_BASELINES } from '@nutai/confidence'
import { SCHEMA_VERSION, type Item, type VisionPayload } from '@nutai/core-schema'
import type { DbAdapter } from '@nutai/db-adapter'
import { openNodeDb } from '@nutai/db-adapter/node'
import type { PersonalPriors } from '@nutai/gram-engine'
import { makeFoodDb, runPipeline } from './index.js'

/**
 * The pipeline against the REAL bundled corpus.
 *
 * 7,928 USDA foods and 14,630 portion records, built by
 * tools/nutrition-data. Not a fixture — the same file the app ships.
 *
 * The fixture tests prove the wiring is correct. This one proves the wiring is
 * correct ABOUT SOMETHING, which is a different and harder claim: a resolver that
 * works on four hand-written rows can still fall over on a corpus where "chicken
 * breast" has 47 plausible matches.
 */

const DB_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/mobile/assets/nutrition.db',
)

const hasCorpus = existsSync(DB_PATH)
const maybe = hasCorpus ? describe : describe.skip

if (!hasCorpus) {
  console.warn(`\n[pipeline] corpus not found at ${DB_PATH} — run \`npm run data:build\` first.\n`)
}

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
      identification_confidence: 0.9, portion_confidence: 0.6,
      assumptions: [], clarifying_questions: [],
    },
  }
}

maybe('the pipeline against the real USDA corpus', () => {
  let db: DbAdapter
  const priors: PersonalPriors = { get: () => null, containers: new Map() }
  const foodDb = makeFoodDb(new Map())

  beforeAll(() => { db = openNodeDb(DB_PATH, { readonly: true }) })
  afterAll(async () => { await db.close() })

  const deps = () => ({ db, priors, baselines: SEEDED_BASELINES, path: 'cloud' as const, now: 1_753_900_000_000 })

  it('has the corpus the build reported', async () => {
    const row = await db.get<{ c: number }>('SELECT COUNT(*) c FROM foods')
    expect(row!.c).toBeGreaterThan(7000)
  })

  it('resolves a real meal to real USDA rows', async () => {
    const r = await runPipeline(
      payload([
        item(),
        item({ name: 'White rice', canonical_food_key: 'rice, white, cooked', food_form: 'piled', model_gram_estimate: 180 }),
        item({ name: 'Broccoli', canonical_food_key: 'broccoli, raw', food_form: 'piled', model_gram_estimate: 90 }),
      ]),
      deps(), foodDb,
    )
    expect(r).not.toBeNull()
    // Every item found a real database row — none fell to the AI-estimate path.
    for (const i of r!.items) {
      expect(i.resolution, `${i.row.displayName} did not resolve`).not.toBe('miss')
      expect(i.row.isEstimate).toBe(false)
      expect(i.row.sourceFoodId).toBeTruthy()
    }
    expect(r!.zeroHitCount).toBe(0)
  })

  it('produces a plausible calorie total for a plausible plate', async () => {
    const r = await runPipeline(
      payload([
        item(),
        item({ name: 'White rice', canonical_food_key: 'rice, white, cooked', model_gram_estimate: 180 }),
      ]),
      deps(), foodDb,
    )
    // ~170g chicken + ~180g rice. Anywhere from 400 to 900 kcal is sane; the
    // point is that it is not 40 and not 9,000.
    expect(r!.totals.kcal).toBeGreaterThan(300)
    expect(r!.totals.kcal).toBeLessThan(1200)
  })

  it('never returns an item whose energy density is physically impossible', async () => {
    const foods = ['banana, raw', 'butter', 'olive oil', 'cheddar cheese', 'almonds', 'lard']
    for (const key of foods) {
      const r = await runPipeline(payload([item({ canonical_food_key: key, model_gram_estimate: 100 })]), deps(), foodDb)
      const row = r!.items[0]!.row
      expect(row.nutrientSnapshot.kcal, `${key} was ${row.nutrientSnapshot.kcal} kcal/100g`).toBeLessThanOrEqual(920)
    }
  })

  it('shows the calories the food log will add, across many real foods (blind test round 2, N3)', async () => {
    const keys = [
      'chicken breast, grilled', 'rice, white, cooked', 'broccoli, raw', 'egg, whole, raw',
      'almonds', 'cheddar cheese', 'salmon, atlantic', 'sweet potato', 'spinach, raw', 'oats',
    ]
    for (const key of keys) {
      const r = await runPipeline(payload([item({ canonical_food_key: key })]), deps(), foodDb)
      const saved = r!.meal.ingredients.reduce((s, row) => s + (row.nutrientSnapshot.kcal * row.grams) / 100, 0) * r!.meal.portionEatenFraction
      expect(r!.totals.kcal, `mismatch for ${key}`).toBe(Math.round(saved))
    }
  })

  it('resolves twenty common foods without a single zero-hit', async () => {
    // §5.5 sets a 5% zero-hit rate as the trigger to add an embedding layer.
    // On a generic-tier corpus, common whole foods must be far under that.
    const keys = [
      'banana, raw', 'apple, raw', 'chicken breast, grilled', 'rice, white, cooked',
      'broccoli, raw', 'egg, whole, raw', 'milk, whole', 'cheddar cheese', 'almonds',
      'salmon, atlantic', 'sweet potato', 'black beans', 'spinach, raw', 'butter',
      'oats', 'yogurt', 'peanut butter', 'ground beef', 'avocado', 'olive oil',
    ]
    let zeroHits = 0
    for (const key of keys) {
      const r = await runPipeline(payload([item({ canonical_food_key: key })]), deps(), foodDb)
      zeroHits += r!.zeroHitCount
    }
    const rate = zeroHits / keys.length
    expect(rate, `zero-hit rate ${(rate * 100).toFixed(1)}% exceeds the 5% trigger`).toBeLessThan(0.05)
  })

  it('uses real FNDDS portion weights when the model reports a count', async () => {
    const portions = await db.all<{ food_id: number; gram_weight: number }>(
      "SELECT p.food_id, p.gram_weight FROM food_portions p JOIN foods f ON f.id=p.food_id WHERE f.name LIKE '%Bananas, raw%' LIMIT 1",
    )
    expect(portions.length).toBeGreaterThan(0)
    expect(portions[0]!.gram_weight).toBeGreaterThan(50)
  })

  it('completes a scan against the full corpus quickly', async () => {
    const started = Date.now()
    await runPipeline(payload([item(), item({ canonical_food_key: 'rice, white, cooked' })]), deps(), foodDb)
    // Resolution is local SQLite. If this is slow, something is scanning rather
    // than using the FTS index.
    expect(Date.now() - started).toBeLessThan(500)
  })

  /**
   * THE HAMBURGER REGRESSION. The first real on-device scan emitted one
   * composite "hamburger" item; the corpus has no such concept, matching
   * degraded, and the user saw 69 g of carbs on a burger. Prompt v1.1.0 now
   * mandates decomposition — this pins what decomposed output must do: every
   * burger COMPONENT resolves to a real row, and the total lands where a
   * burger lands.
   */
  it('resolves a decomposed hamburger component by component', async () => {
    const r = await runPipeline(
      payload([
        item({ name: 'Beef patty', canonical_food_key: 'ground beef, patty, cooked', food_form: 'flat', model_gram_estimate: 90 }),
        item({ name: 'Hamburger bun', canonical_food_key: 'bun, hamburger', food_form: 'discrete', qualitative_size: 'count:1', model_gram_estimate: 50, fallback_macros_at_estimate: { calories_kcal: 140, protein_g: 5, carbs_g: 26, fat_g: 2, fiber_g: 1, sodium_mg: 250 } }),
        item({ name: 'Tomato slices', canonical_food_key: 'tomatoes, raw', food_form: 'discrete', qualitative_size: 'count:2', model_gram_estimate: 40, fallback_macros_at_estimate: { calories_kcal: 7, protein_g: 0.4, carbs_g: 1.6, fat_g: 0, fiber_g: 0.5, sodium_mg: 2 } }),
        item({ name: 'Lettuce', canonical_food_key: 'lettuce, raw', food_form: 'discrete', qualitative_size: 'count:1', model_gram_estimate: 10, fallback_macros_at_estimate: { calories_kcal: 2, protein_g: 0.1, carbs_g: 0.3, fat_g: 0, fiber_g: 0.2, sodium_mg: 3 } }),
      ]),
      deps(),
      foodDb,
    )
    expect(r).not.toBeNull()
    for (const i of r!.items) {
      expect(i.resolution, `${i.row.displayName} did not resolve`).not.toBe('miss')
    }
    // A modest burger. The regression showed 291 kcal with 69g carbs / 1g
    // protein — protein-starved nonsense. Decomposed, protein must dominate
    // carbs-from-vegetables and the total must be burger-shaped.
    expect(r!.totals.kcal).toBeGreaterThan(250)
    expect(r!.totals.kcal).toBeLessThan(700)
    expect(r!.totals.protein_g).toBeGreaterThan(15)
  })
})
