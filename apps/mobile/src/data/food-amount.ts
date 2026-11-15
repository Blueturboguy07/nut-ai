import type { DbAdapter } from '@nutai/db-adapter'
import type { NutrientRow100g } from '@nutai/core-schema'

/**
 * The amount step of the Food Database (app/food-search.tsx): the servings of
 * one food, a sensible default serving, and the live totals for an amount.
 *
 * Blind test round 2 (Nov 15 2026, N4): one tap logged a fixed amount with no
 * amount step, and the numbers were wrong ("Bananas, raw" took 450 kcal, one
 * whole egg 38 kcal). Two causes: the tap took the FIRST portion row of the
 * food (for a banana "1 cup, mashed", 225 g), and the log stored the snapshot
 * already scaled to the grams, which the day totals then scaled a second
 * time (manual-food.ts; fixed there). Now the person picks the amount, and
 * the default serving is a realistic one:
 *
 *   1. an egg: the "large" egg (the US standard size; 50 g, about 72 kcal);
 *   2. anything else sold by size: the "medium" one (a medium banana, 118 g,
 *      about 105 kcal);
 *   3. the FNDDS default portion;
 *   4. one piece, slice or other single unit;
 *   5. the first household measure USDA lists (a cup, a tablespoon);
 *   6. 100 g, only when USDA lists no portion at all.
 *
 * Pure: no React Native imports, so the tests run it in node against real
 * SQLite (food-amount.test.ts; food-amount.corpus.test.ts on the real corpus).
 */

export interface Serving {
  /** "1 medium (7" to 7-7/8" long)", "1 cup, mashed", "100 g". */
  label: string
  grams: number
}

export interface FoodFacts {
  foodId: number
  name: string
  per100: NutrientRow100g
  servings: Serving[]
  /** The index in `servings` of the default serving. */
  defaultIndex: number
}

interface PortionRow {
  id: number
  measure_unit: string | null
  modifier: string | null
  amount: number | null
  gram_weight: number
  is_fndds_default: number
}

const UNIT_WORDS =
  /^(piece|slice|unit|each|link|wedge|steak|fillet|patty|bar|cookie|egg|stick|sandwich|burrito|taco|drumstick|thigh|wing|breast|roll|bun|muffin|bagel|pancake|waffle|tortilla|cracker|nugget|meatball|sausage|frank|donut|doughnut|fruit|banana|apple|orange|pear|peach|plum)\b/i

/** The amount as people say it: 1, 0.5, 1.5 (never 1.0000001). */
function amountText(a: number | null): string {
  if (a == null || !Number.isFinite(a) || a <= 0) return '1'
  return String(Math.round(a * 100) / 100)
}

/** The words of a portion row, without USDA's "undetermined" unit. */
function portionWords(r: Pick<PortionRow, 'measure_unit' | 'modifier'>): string {
  const unit = (r.measure_unit ?? '').trim()
  const mod = (r.modifier ?? '').trim()
  const u = /^undetermined$/i.test(unit) ? '' : unit
  if (!u) return mod
  if (!mod) return u
  if (mod.toLowerCase().startsWith(u.toLowerCase())) return mod
  return mod.startsWith(',') ? `${u}${mod}` : `${u} ${mod}`
}

export function servingLabel(r: Pick<PortionRow, 'measure_unit' | 'modifier' | 'amount'>): string {
  const words = portionWords(r)
  return words ? `${amountText(r.amount)} ${words}` : `${amountText(r.amount)} serving`
}

/** One of the thing: an amount of 1 (or none given). */
const single = (r: PortionRow) => r.amount == null || r.amount === 1

/**
 * The index of the default serving in `rows` (rule above); -1 when there is
 * no portion row (then 100 g). Pure, exported for the tests.
 */
export function defaultPortionIndex(foodName: string, rows: PortionRow[]): number {
  if (rows.length === 0) return -1
  const words = rows.map((r) => portionWords(r).toLowerCase())
  const sized = (size: string) => rows.findIndex((r, i) => single(r) && new RegExp(`^${size}\\b`).test(words[i]!))
  if (/^eggs?\b/i.test(foodName.trim())) {
    const large = sized('large')
    if (large >= 0) return large
  }
  const medium = sized('medium')
  if (medium >= 0) return medium
  const fndds = rows.findIndex((r) => r.is_fndds_default === 1)
  if (fndds >= 0) return fndds
  const unit = rows.findIndex((r, i) => single(r) && UNIT_WORDS.test(words[i]!))
  if (unit >= 0) return unit
  return 0
}

/** The servings of one food (its USDA portions, then 100 g) and the default one. null: no such food. */
export async function foodFacts(nutritionDb: DbAdapter, foodId: number): Promise<FoodFacts | null> {
  const food = await nutritionDb.get<{
    name: string
    energy_kcal: number | null
    protein_g: number | null
    fat_g: number | null
    carb_g: number | null
    fiber_g: number | null
    sugar_g: number | null
    sodium_mg: number | null
  }>('SELECT name, energy_kcal, protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg FROM foods WHERE id = ?', [foodId])
  if (!food) return null
  const rows = await nutritionDb.all<PortionRow>(
    `SELECT id, measure_unit, modifier, amount, gram_weight, is_fndds_default
       FROM food_portions WHERE food_id = ? AND gram_weight > 0 ORDER BY id`,
    [foodId],
  )
  // One serving per label (USDA lists some twice).
  const seen = new Set<string>()
  const kept: PortionRow[] = []
  for (const r of rows) {
    const key = servingLabel(r).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(r)
  }
  const def = defaultPortionIndex(food.name, kept)
  const servings: Serving[] = kept.map((r) => ({ label: servingLabel(r), grams: r.gram_weight }))
  servings.push({ label: '100 g', grams: 100 })
  return {
    foodId,
    name: food.name,
    per100: {
      kcal: food.energy_kcal ?? 0,
      protein_g: food.protein_g ?? 0,
      fat_g: food.fat_g ?? 0,
      carbs_g: food.carb_g ?? 0,
      fiber_g: food.fiber_g ?? null,
      sugar_g: food.sugar_g ?? null,
      sodium_mg: food.sodium_mg ?? null,
    },
    servings,
    defaultIndex: def >= 0 ? def : servings.length - 1,
  }
}

export interface AmountTotals {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

/**
 * The totals for `grams` of a food, rounded the way the screen shows them
 * (whole kcal, grams to one decimal). The log stores the per-100 g values and
 * the grams, and the day totals compute the same numbers.
 */
export function amountTotals(per100: NutrientRow100g, grams: number): AmountTotals {
  const g = Number.isFinite(grams) && grams > 0 ? grams : 0
  const one = (v: number) => Math.round(v * 10) / 10
  return {
    kcal: Math.round((per100.kcal * g) / 100),
    protein_g: one((per100.protein_g * g) / 100),
    carbs_g: one((per100.carbs_g * g) / 100),
    fat_g: one((per100.fat_g * g) / 100),
  }
}

/** The grams a person typed: a number from 1 to 5000, or null. */
export function parseGrams(text: string): number | null {
  const n = Number(text.replace(',', '.').trim())
  if (!Number.isFinite(n) || n < 1 || n > 5000) return null
  return Math.round(n * 10) / 10
}
