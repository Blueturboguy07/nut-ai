import { clamp, type ClampFlag } from '@nutai/clamp'
import {
  VisionPayloadZ,
  type IngredientRow,
  type Item,
  type LoggedMeal,
  type NutrientRow100g,
  type VisionPayload,
} from '@nutai/core-schema'
import {
  computeBand,
  mealBand,
  type Band,
  type InferencePath,
  type MeasuredBaselines,
} from '@nutai/confidence'
import type { DbAdapter } from '@nutai/db-adapter'
import {
  estimateGrams,
  type FoodDb,
  type PersonalPriors,
  type ResolvedRow,
} from '@nutai/gram-engine'
import { selectMealQuestions, type SelectedQuestion } from '@nutai/repair'
import { loadFood, resolveByBarcode, resolveByText, type ResolvedFood } from '@nutai/resolver'
import { recomputeTotals, toDisplayTotals, type DisplayTotals } from '@nutai/totals'

/**
 * The pipeline — stages 4 through 9, wired.
 *
 * SPEC-accuracy-engine.md §1.1. This module is the seam where every other package
 * becomes one system, and it is deliberately PURE: it takes a VisionPayload and a
 * database handle and returns a ScanResult. It performs no network I/O, holds no
 * credentials, and touches no platform API.
 *
 * That purity is what lets the eval harness run the REAL pipeline — not a
 * reimplementation of it — against the golden set under plain Node. A harness that
 * scored raw model output would measure the wrong thing entirely, because most of
 * the accuracy lives in these stages rather than in the model call.
 *
 *   [3] INFERENCE          <- the caller does this; the ONLY path-divergent stage
 *   [4] EXTRACT + CLAMP    Zod validate, then the non-skippable sanity clamp
 *   [5] GRAMS              the reconciliation ladder
 *   [6] RESOLVE            barcode exact -> FTS5 -> six-signal scoring
 *   [7] TOTALS             pure arithmetic
 *   [8] CONFIDENCE         measured bands, structural widening, quadrature
 *   [9] RESULT + REPAIR    questions and pre-answered chips
 *
 * NOTHING AFTER STAGE 3 BRANCHES ON `path` except to render a badge and widen a
 * band. That is the entire point of the architecture: Path A and Path B converge
 * on one VisionPayload and share every line of code below it.
 */

export interface PipelineDeps {
  db: DbAdapter
  priors: PersonalPriors
  baselines: MeasuredBaselines
  path: InferencePath
  /** Barcode decoded on-frame, if any. Short-circuits resolution for that item. */
  barcode?: string | undefined
  /** Tight calorie budgets make the same absolute error matter more. */
  severityWeight?: number | undefined
  now: number
}

export interface ResolvedItem {
  row: IngredientRow
  band: Band
  /** How the food was matched, for the UI badge and for eval attribution. */
  resolution: 'barcode' | 'auto_accept' | 'disambiguate' | 'miss'
  /** Offered when resolution was ambiguous — the 3-5 candidate sheet. */
  candidates?: Array<{ foodId: string; name: string; brand: string | null; kcalPer100g: number | null }>
  gramPathway: string
  /** Set when two gram signals disagreed enough to become a question. */
  gramDisagreement?: { low: number; high: number }
}

export interface ScanResult {
  isFood: boolean
  refusalReason: string | null
  items: ResolvedItem[]
  meal: LoggedMeal
  totals: DisplayTotals
  mealBand: Band
  questions: SelectedQuestion[]
  clampFlags: ClampFlag[]
  /** Items whose canonical key returned nothing — feeds the 5% upgrade trigger. */
  zeroHitCount: number
}

/** Adapts the nutrition corpus to the gram engine's narrow FoodDb interface. */
export function makeFoodDb(portionsByFood: ReadonlyMap<string, Record<string, number>>): FoodDb {
  return {
    fnddsPortionGrams(foodId, measure) {
      return portionsByFood.get(foodId)?.[measure] ?? null
    },
  }
}

function snapshotFrom(food: ResolvedFood): NutrientRow100g {
  return {
    kcal: food.energyKcal ?? 0,
    protein_g: food.proteinG ?? 0,
    fat_g: food.fatG ?? 0,
    carbs_g: food.carbG ?? 0,
    // null means NOT REPORTED. Never a fabricated zero — USDA's own disclaimer is
    // explicit that a missing value means data were not supplied.
    fiber_g: food.fiberG,
    sugar_g: food.sugarG,
    sodium_mg: food.sodiumMg,
  }
}

/**
 * The MISS path.
 *
 * When resolution yields nothing acceptable, log the model's own
 * fallback_macros_at_estimate, flag is_estimate, and let the UI show the amber
 * "AI ESTIMATE" badge. This is the concrete mechanism behind the whole
 * accuracy-honesty position — and it is exactly what a plain calorie estimate
 * never shows.
 */
function snapshotFromFallback(item: Item, grams: number): NutrientRow100g {
  const m = item.fallback_macros_at_estimate
  // The model's macros are AT its gram estimate, not per 100 g. Convert, guarding
  // against a zero-gram estimate producing Infinity.
  const per100 = grams > 0 ? 100 / grams : 0
  return {
    kcal: m.calories_kcal * per100,
    protein_g: m.protein_g * per100,
    fat_g: m.fat_g * per100,
    carbs_g: m.carbs_g * per100,
    fiber_g: m.fiber_g == null ? null : m.fiber_g * per100,
    sugar_g: null,
    sodium_mg: m.sodium_mg == null ? null : m.sodium_mg * per100,
  }
}

/** Stage 4: Zod validation. Returns null when the payload is unusable. */
export function validatePayload(raw: unknown): VisionPayload | null {
  const parsed = VisionPayloadZ.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export async function runPipeline(
  rawPayload: unknown,
  deps: PipelineDeps,
  foodDb: FoodDb,
): Promise<ScanResult | null> {
  // ---- [4] EXTRACT + CLAMP -------------------------------------------------
  const validated = validatePayload(rawPayload)
  if (!validated) return null

  const { payload, flags } = clamp(validated)

  if (!payload.is_food) {
    return {
      isFood: false,
      refusalReason: payload.refusal_reason,
      items: [],
      meal: emptyMeal(deps.now),
      totals: toDisplayTotals({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }),
      mealBand: { halfPct: 0, tier: 'none', reasons: [] },
      questions: [],
      clampFlags: flags,
      zeroHitCount: 0,
    }
  }

  const items: ResolvedItem[] = []
  let zeroHitCount = 0

  for (const [index, item] of payload.items.entries()) {
    // ---- [6a] Barcode short-circuit, before any estimation ------------------
    let food: ResolvedFood | null = null
    let resolution: ResolvedItem['resolution'] = 'miss'
    let candidates: ResolvedItem['candidates']

    if (deps.barcode && index === 0) {
      food = await resolveByBarcode(deps.db, deps.barcode)
      if (food) resolution = 'barcode'
    }

    // ---- [5] GRAMS ----------------------------------------------------------
    // Run BEFORE text resolution, because portion plausibility is one of the six
    // scoring signals — the resolver wants to know we are looking at 150 g before
    // it decides whether "bouillon cube" is a plausible match.
    const resolvedRow: ResolvedRow | null = food
      ? { foodId: food.foodId, description: food.name, servingSizeG: food.servingSizeG }
      : null

    const gram = estimateGrams({
      item,
      priors: deps.priors,
      db: foodDb,
      resolved: resolvedRow,
      barcodeMatch: resolution === 'barcode',
    })

    // ---- [6b] Text resolution ------------------------------------------------
    if (!food) {
      const r = await resolveByText(deps.db, {
        canonicalFoodKey: item.canonical_food_key,
        observedBrand: item.brand,
        prepFacet: prepFacetFor(item),
        modelCategory: null,
        estimatedGrams: gram.grams,
      })
      if (r.zeroHit) zeroHitCount++

      if (r.outcome.kind === 'auto_accept') {
        food = await loadFood(deps.db, r.outcome.match.foodId)
        resolution = 'auto_accept'
      } else if (r.outcome.kind === 'disambiguate') {
        resolution = 'disambiguate'
        candidates = r.outcome.candidates.map((c) => ({
          foodId: c.foodId,
          name: c.name,
          brand: c.brand,
          kcalPer100g: c.energyKcal,
        }))
        // Take the top candidate provisionally so the user sees a number rather
        // than a blank while they decide. It is labeled, and one tap changes it.
        food = await loadFood(deps.db, r.outcome.candidates[0]?.foodId ?? '')
      }
    }

    const isMiss = food == null
    const snapshot = food ? snapshotFrom(food) : snapshotFromFallback(item, gram.grams)

    const row: IngredientRow = {
      id: `item-${index}`,
      displayName: item.name,
      sourceFoodId: food?.foodId ?? null,
      grams: gram.grams,
      nutrientSnapshot: snapshot,
      origin: resolution === 'barcode' ? 'barcode' : isMiss ? 'vision_model' : 'db_search',
      gramPathway: gram.pathway,
      bandHalfPct: gram.halfPct,
      isEstimate: isMiss,
      assumptions: item.stated_assumptions.map((a) => ({ type: a, userConfirmed: false })),
    }

    // ---- [8] CONFIDENCE ------------------------------------------------------
    const band = computeBand({
      row,
      item,
      baselines: deps.baselines,
      path: deps.path,
      hadClampFlag: flags.some((f) => f.item === item.name),
    })
    row.bandHalfPct = band.halfPct

    items.push({
      row,
      band,
      resolution,
      ...(candidates ? { candidates } : {}),
      gramPathway: gram.pathway,
      ...(gram.surfaceDisagreementQuestion && gram.rivalGrams != null
        ? {
            gramDisagreement: {
              low: Math.min(gram.grams, gram.rivalGrams),
              high: Math.max(gram.grams, gram.rivalGrams),
            },
          }
        : {}),
    })

    // The oil correction adds MASS to the food; it must also add FAT, or the
    // correction silently understates calories while claiming to fix them.
    if (gram.addedOilGrams != null && gram.addedOilGrams > 0) {
      items.push({
        row: {
          id: `item-${index}-oil`,
          displayName: 'Cooking oil (absorbed)',
          sourceFoodId: null,
          grams: gram.addedOilGrams,
          // Per 100 g of vegetable oil.
          nutrientSnapshot: { kcal: 884, protein_g: 0, fat_g: 100, carbs_g: 0, fiber_g: 0, sodium_mg: 0 },
          origin: 'assumption_filler',
          gramPathway: gram.pathway,
          bandHalfPct: 0.5,
          isEstimate: true,
          assumptions: [{ type: 'oil_added', gramsEquiv: gram.addedOilGrams, userConfirmed: false }],
        },
        band: { halfPct: 0.5, tier: 'very_wide', reasons: ['Absorbed frying oil is not visible.'] },
        resolution: 'miss',
        gramPathway: gram.pathway,
      })
    }
  }

  // ---- [7] TOTALS ----------------------------------------------------------
  const meal: LoggedMeal = {
    id: `meal-${deps.now}`,
    loggedAt: new Date(deps.now).toISOString(),
    ingredients: items.map((i) => i.row),
    portionEatenFraction: 1,
    engineId: 'nutai-pipeline-v1',
    promptVersion: null,
    schemaVersion: payload.schema_version,
    clampFlags: flags,
  }
  const totals = toDisplayTotals(recomputeTotals(meal))

  const banded = items.map((i) => ({
    kcal: (i.row.nutrientSnapshot.kcal * i.row.grams) / 100,
    band: i.band,
  }))

  // ---- [9] RESULT + REPAIR --------------------------------------------------
  const questions = selectMealQuestions(
    payload.items.map((item, i) => ({
      item,
      ...(items[i]?.gramDisagreement ? { gramDisagreement: items[i]!.gramDisagreement } : {}),
      ...(deps.severityWeight != null ? { severityWeight: deps.severityWeight } : {}),
    })),
  )

  return {
    isFood: true,
    refusalReason: null,
    items,
    meal,
    totals,
    mealBand: mealBand(banded),
    questions,
    clampFlags: flags,
    zeroHitCount,
  }
}

function prepFacetFor(item: Item): string | null {
  if (item.cooking_method_cues.includes('grill_marks')) return 'grilled'
  if (item.cooking_method_cues.includes('deep_fried_color')) return 'fried'
  if (item.cooking_method_cues.includes('boiled')) return 'boiled'
  if (item.cooking_method_cues.includes('raw')) return 'raw'
  return null
}

function emptyMeal(now: number): LoggedMeal {
  return {
    id: `meal-${now}`,
    loggedAt: new Date(now).toISOString(),
    ingredients: [],
    portionEatenFraction: 1,
    engineId: 'nutai-pipeline-v1',
    promptVersion: null,
    schemaVersion: null,
    clampFlags: [],
  }
}

/**
 * Re-run stages 7-8 after ANY user edit.
 *
 * This is the whole repair loop. It is local, instant, free, and works offline on
 * both paths — because every row already carries its per-100 g snapshot, so an
 * edit is arithmetic rather than a reason to call a model again.
 */
export function recomputeAfterEdit(meal: LoggedMeal, bands: readonly Band[]): {
  totals: DisplayTotals
  mealBand: Band
} {
  const totals = toDisplayTotals(recomputeTotals(meal))
  const banded = meal.ingredients.map((row, i) => ({
    kcal: ((row.nutrientSnapshot.kcal * row.grams) / 100) * meal.portionEatenFraction,
    band: bands[i] ?? { halfPct: row.bandHalfPct, tier: 'moderate' as const, reasons: [] },
  }))
  return { totals, mealBand: mealBand(banded) }
}
