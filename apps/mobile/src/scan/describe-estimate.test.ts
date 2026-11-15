import { beforeEach, describe, expect, it } from 'vitest'
import { SEEDED_BASELINES } from '@nutai/confidence'
import { SCHEMA_VERSION, type Item } from '@nutai/core-schema'
import { NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { PersonalPriors } from '@nutai/gram-engine'
import { makeFoodDb, runPipeline, validatePayload } from '@nutai/pipeline'
import { DESCRIBED_AMOUNTS_RULE, DESCRIBED_FAT_RULE, describedMealBlock } from '@nutai/prompt'
import { estimateRangeSentence } from './estimate-copy'

/**
 * Describe a meal: five fixed prompt/response cases (the model answer is
 * mocked; no network). Blind test round 2 (Nov 15 2026, N3): "two scrambled
 * eggs and one slice of buttered toast" came back at 229 kcal (plausible:
 * 250-400), and saving took 227 kcal off the day, not 229.
 *
 * Each case checks:
 *   1. the prompt fences the words and carries the amount and added-fat rules;
 *   2. the mocked answer parses (the app's own validator) with the stated
 *      counts and the fat as its own item;
 *   3. the pipeline's total is in a plausible range, and the calories shown
 *      are the calories the food log saves (one rounded value).
 *
 * The food rows are fixed USDA SR Legacy values, so the totals are exact.
 */

interface Food {
  id: number
  name: string
  kcal: number
  p: number
  f: number
  c: number
  portions: Record<string, number>
}

const FOODS: Food[] = [
  { id: 1, name: 'Egg, whole, cooked, scrambled', kcal: 149, p: 9.99, f: 10.98, c: 1.61, portions: { per_unit: 61 } },
  { id: 2, name: 'Bread, white, commercially prepared, toasted', kcal: 293, p: 9, f: 4, c: 54.4, portions: { per_unit: 25 } },
  { id: 3, name: 'Butter, salted', kcal: 717, p: 0.85, f: 81.11, c: 0.06, portions: { small: 5, medium: 14.2, per_unit: 5 } },
  { id: 4, name: 'Rice, white, long-grain, regular, cooked', kcal: 130, p: 2.69, f: 0.28, c: 28.17, portions: { small: 79, medium: 158, large: 237 } },
  { id: 5, name: 'Egg, whole, cooked, fried', kcal: 196, p: 13.61, f: 14.84, c: 0.83, portions: { per_unit: 46 } },
  { id: 6, name: 'Oil, olive, salad or cooking', kcal: 884, p: 0, f: 100, c: 0, portions: { small: 4.5, medium: 13.5 } },
  { id: 7, name: 'Bananas, raw', kcal: 89, p: 1.09, f: 0.33, c: 22.84, portions: { per_unit: 118, medium: 118 } },
]

/** One item as a model answers it for a typed meal (no photo: no references, no cues). */
function item(over: Partial<Item> & Pick<Item, 'name' | 'canonical_food_key' | 'qualitative_size'>): Item {
  return {
    brand: null,
    food_form: 'discrete',
    weight_basis: 'as_served',
    model_gram_estimate: null,
    identification_confidence: 0.85,
    portion_confidence: 0.5,
    uncertainty_reason: 'none',
    visible_reference_objects: [],
    container: null,
    cooking_method_cues: [],
    is_beverage: false,
    beverage_category: null,
    legible_label_text: null,
    stated_assumptions: [],
    clarifying_questions: [],
    fallback_macros_at_estimate: { calories_kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 4.4, fiber_g: null, sodium_mg: null },
    ...over,
  }
}

const butter = (name: string, why: string): Item =>
  item({
    name,
    canonical_food_key: 'butter, salted',
    food_form: 'spread',
    qualitative_size: 'small',
    model_gram_estimate: 5,
    uncertainty_reason: 'oil_or_fat_not_visually_determinable',
    stated_assumptions: [why],
    fallback_macros_at_estimate: { calories_kcal: 36, protein_g: 0, carbs_g: 0, fat_g: 4, fiber_g: null, sodium_mg: null },
  })

/** The model's answer, as the JSON text it sends. */
function answer(items: Item[]): string {
  return JSON.stringify({
    schema_version: SCHEMA_VERSION,
    is_food: true,
    refusal_reason: null,
    items,
    meal_overall: { identification_confidence: 0.85, portion_confidence: 0.5, assumptions: [], clarifying_questions: [] },
  })
}

interface Case {
  description: string
  response: string
  /** canonical_food_key → qualitative_size, as parsed. */
  sizes: Array<[string, string]>
  /** How many items are added fat (butter, oil). */
  fatItems: number
  kcal: [number, number]
}

const CASES: Case[] = [
  {
    // The case from the blind test.
    description: 'two scrambled eggs and one slice of buttered toast',
    response: answer([
      item({ name: 'Scrambled eggs', canonical_food_key: 'egg, whole, cooked, scrambled', qualitative_size: 'count:2', model_gram_estimate: 122 }),
      item({ name: 'White toast', canonical_food_key: 'bread, white, toasted', qualitative_size: 'count:1', model_gram_estimate: 25 }),
      butter('Butter on the toast', 'Assumed about 5 g of butter on the slice of toast.'),
      butter('Butter for scrambling', 'Assumed about 5 g of butter in the pan for the eggs.'),
    ]),
    sizes: [
      ['egg, whole, cooked, scrambled', 'count:2'],
      ['bread, white, toasted', 'count:1'],
      ['butter, salted', 'small'],
      ['butter, salted', 'small'],
    ],
    fatItems: 2,
    kcal: [250, 400],
  },
  {
    description: 'a cup of cooked white rice',
    response: answer([
      item({ name: 'White rice', canonical_food_key: 'rice, white, cooked', food_form: 'piled', qualitative_size: 'medium', model_gram_estimate: 158 }),
    ]),
    sizes: [['rice, white, cooked', 'medium']],
    fatItems: 0,
    kcal: [150, 260],
  },
  {
    description: '3 fried eggs',
    response: answer([
      item({ name: 'Fried eggs', canonical_food_key: 'egg, whole, cooked, fried', qualitative_size: 'count:3', model_gram_estimate: 138 }),
      item({
        name: 'Oil for frying',
        canonical_food_key: 'oil, olive',
        food_form: 'spread',
        qualitative_size: 'small',
        model_gram_estimate: 5,
        uncertainty_reason: 'oil_or_fat_not_visually_determinable',
        stated_assumptions: ['Assumed about 5 g of oil in the pan.'],
        fallback_macros_at_estimate: { calories_kcal: 44, protein_g: 0, carbs_g: 0, fat_g: 5, fiber_g: null, sodium_mg: null },
      }),
    ]),
    sizes: [
      ['egg, whole, cooked, fried', 'count:3'],
      ['oil, olive', 'small'],
    ],
    fatItems: 1,
    kcal: [250, 380],
  },
  {
    description: 'a banana',
    response: answer([item({ name: 'Banana', canonical_food_key: 'bananas, raw', qualitative_size: 'count:1', model_gram_estimate: 118 })]),
    sizes: [['bananas, raw', 'count:1']],
    fatItems: 0,
    kcal: [90, 120],
  },
  {
    description: 'dry toast, two slices, no butter',
    response: answer([
      item({ name: 'White toast', canonical_food_key: 'bread, white, toasted', qualitative_size: 'count:2', model_gram_estimate: 50 }),
    ]),
    sizes: [['bread, white, toasted', 'count:2']],
    fatItems: 0,
    kcal: [120, 180],
  },
]

const priors: PersonalPriors = { get: () => null, containers: new Map() }
const foodDb = makeFoodDb(new Map(FOODS.map((f) => [String(f.id), f.portions])))
let db: DbAdapter

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec(NUTRITION_SCHEMA)
  await db.exec(NUTRITION_FTS_SCHEMA)
  for (const f of FOODS) {
    await db.run(
      `INSERT INTO foods (id,source,name,prep_facet,energy_kcal,protein_g,fat_g,carb_g,barcode,
                          serving_size_g,license,basis_confidence,completeness_score,popularity_rank)
       VALUES (?,'fdc_sr_legacy',?,NULL,?,?,?,?,NULL,NULL,'CC0','high',0.95,?)`,
      [f.id, f.name, f.kcal, f.p, f.f, f.c, f.id * 10],
    )
    await db.run('INSERT INTO food_fts (rowid,name,brand,synonyms) VALUES (?,?,?,?)', [f.id, f.name, '', ''])
  }
})

describe('Describe a meal: five fixed prompt/response cases', () => {
  for (const c of CASES) {
    describe(`"${c.description}"`, () => {
      it('the prompt fences the words and asks for every amount and the added fat', () => {
        const block = describedMealBlock(c.description)
        expect(block).toContain(`<meal_description>${c.description}</meal_description>`)
        expect(block).toContain(DESCRIBED_AMOUNTS_RULE)
        expect(block).toContain(DESCRIBED_FAT_RULE)
      })

      it('the answer parses with the stated counts and the fat as its own item', () => {
        const parsed = validatePayload(JSON.parse(c.response))
        expect(parsed).not.toBeNull()
        expect(parsed!.items.map((i) => [i.canonical_food_key, i.qualitative_size])).toEqual(c.sizes)
        const fat = parsed!.items.filter((i) => /^(butter|oil)\b/.test(i.canonical_food_key))
        expect(fat).toHaveLength(c.fatItems)
        for (const f of fat) expect(f.stated_assumptions.join(' ')).toMatch(/\d+ g/)
      })

      it('the total is plausible, and the calories shown are the calories saved', async () => {
        const r = await runPipeline(JSON.parse(c.response), { db, priors, baselines: SEEDED_BASELINES, path: 'cloud', now: 1_763_200_000_000 }, foodDb)
        expect(r).not.toBeNull()
        const shown = r!.totals.kcal
        // What the food log adds on save (repo.ts logMeal + dayTotals).
        const saved = r!.meal.ingredients.reduce((s, row) => s + (row.nutrientSnapshot.kcal * row.grams) / 100, 0) * r!.meal.portionEatenFraction
        console.log(`"${c.description}": ${shown} kcal`, r!.meal.ingredients.map((x) => `${x.displayName} ${Math.round(x.grams)} g`).join(', '))
        expect(shown).toBe(Math.round(saved))
        expect(shown).toBeGreaterThanOrEqual(c.kcal[0])
        expect(shown).toBeLessThanOrEqual(c.kcal[1])
      })
    })
  }

  it('the result says plainly that it is an estimate with a range', () => {
    const s = estimateRangeSentence(320, { halfPct: 0.25, tier: 'moderate', reasons: [] })
    expect(s).toBe('This is an estimate, not a measurement. The true value is probably between 240 and 400 kcal.')
    expect(estimateRangeSentence(320, { halfPct: 0, tier: 'none', reasons: [] })).toBeNull()
  })
})
