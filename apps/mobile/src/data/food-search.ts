import type { DbAdapter } from '@nutai/db-adapter'
import { resolveByText, type ScoredCandidate } from '@nutai/resolver'

/**
 * The Food Database search, for the screen (app/food-search.tsx) and for the
 * CI self-test (foodDbSelfTest). ZERO React Native imports, so the tests run
 * it in node against a real SQLite database (food-search.test.ts). It reads
 * only the bundled food database on the phone: no network, so manual food
 * logging works offline.
 */

export interface FoodSearch {
  results: ScoredCandidate[]
  /** best: one clear match; many: pick one; none: no match. */
  outcome: 'best' | 'many' | 'none'
}

export async function searchFoods(db: DbAdapter, query: string): Promise<FoodSearch> {
  const r = await resolveByText(db, {
    canonicalFoodKey: query,
    observedBrand: null,
    prepFacet: null,
    modelCategory: null,
    estimatedGrams: 150,
  })
  if (r.outcome.kind === 'auto_accept') return { results: [r.outcome.match], outcome: 'best' }
  if (r.outcome.kind === 'disambiguate') return { results: r.outcome.candidates, outcome: 'many' }
  return { results: [], outcome: 'none' }
}

/** How many foods the bundled database holds; 0 when it is empty or cannot be read. */
export async function foodCount(db: DbAdapter): Promise<number> {
  try {
    return (await db.get<{ c: number }>('SELECT COUNT(*) c FROM foods'))?.c ?? 0
  } catch {
    return 0
  }
}

/** The word the CI self-test searches for (blind test round 1, Nov 14 2026: "egg" found nothing). */
export const SELF_TEST_QUERY = 'egg'

/**
 * The food database line of the CI self-test (test builds only; app/_layout.tsx
 * registers it, mobile-build.yml reads it): "food-db self-test: ok N foods,
 * M matches for egg", or "food-db self-test: failed: <why>". Never throws.
 */
export async function foodDbSelfTest(db: DbAdapter): Promise<string> {
  try {
    const foods = await foodCount(db)
    if (foods === 0) return 'food-db self-test: failed: the bundled food database is empty or missing'
    const found = await searchFoods(db, SELF_TEST_QUERY)
    if (found.results.length === 0) return `food-db self-test: failed: no match for ${SELF_TEST_QUERY} in ${foods} foods`
    const first = found.results[0]!.name
    return `food-db self-test: ok ${foods} foods, ${found.results.length} matches for ${SELF_TEST_QUERY} (first: ${first})`
  } catch (e) {
    return `food-db self-test: failed: ${e instanceof Error ? e.message : String(e)}`
  }
}
