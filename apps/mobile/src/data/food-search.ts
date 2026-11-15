import type { DbAdapter } from '@nutai/db-adapter'

/**
 * The Food Database search, for the screen (app/food-search.tsx) and for the
 * CI self-test (foodDbSelfTest). ZERO React Native imports, so the tests run
 * it in node against a real SQLite database (food-search.test.ts, and
 * food-amount.corpus.test.ts against the real bundled corpus). It reads only
 * the bundled food database on the phone: no network, so manual food logging
 * works offline.
 *
 * Blind test round 2 (Nov 15 2026, N6): "rice" found no plain rice and
 * "banana" listed one food twice. The screen no longer uses the photo
 * resolver (which keeps at most five candidates, ranked for a model's label);
 * it asks the full-text index for every match and ranks PLAIN foods first:
 * a name whose first part is the word itself ("Rice, white, ...", "Bananas,
 * raw") before a name that only contains it ("Rice noodles", "Babyfood,
 * bananas"), shorter names before longer ones. Two foods with the same name
 * show once.
 */

export interface FoodHit {
  foodId: number
  name: string
  /** kcal per 100 g; null when the corpus has no value. */
  energyKcal: number | null
}

export interface FoodSearch {
  results: FoodHit[]
  /** best: one match; many: pick one; none: no match. */
  outcome: 'best' | 'many' | 'none'
}

/** How many rows the screen lists. */
export const MAX_RESULTS = 25
/** How many full-text matches are ranked (plenty for any one word). */
const CANDIDATES = 400

/** The words of a query, for an FTS5 prefix query: letters and digits only. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
    .slice(0, 6)
}

/** "rice" also names "Rices"; "banana" names "Bananas"; "berries" names "Berry". */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '')
  return stem(a) === stem(b)
}

/**
 * The rank of one name for the query words; higher first. Pure, exported for
 * the tests.
 */
export function rankName(name: string, words: string[]): number {
  const lower = name.toLowerCase()
  const parts = lower.split(',').map((p) => p.trim()).filter(Boolean)
  const head = parts[0] ?? ''
  const headWords = head.split(/[^a-z0-9]+/).filter(Boolean)
  let score = 0
  const first = words[0] ?? ''
  if (headWords.length === 1 && sameWord(headWords[0]!, first)) score += 100
  else if (headWords.length > 0 && sameWord(headWords[0]!, first)) score += 50
  else if (headWords.some((w) => sameWord(w, first))) score += 25
  // Every other query word that is in the name.
  for (const w of words.slice(1)) if (lower.includes(w)) score += 10
  // Plain foods first: fewer parts, shorter names.
  score -= parts.length * 3
  score -= lower.length / 40
  // Not a babyfood, a formula or a restaurant dish when a plain food matches.
  if (/^(babyfood|infant formula|fast foods?|restaurant)/.test(head)) score -= 40
  // The form people log (blind test round 2, N6): "egg" puts a whole egg
  // above dried yolk, "rice" puts cooked rice above a restaurant dish.
  for (const p of parts.slice(1)) {
    if (PROCESSED_PART.test(p)) score -= 8
    if (PLAIN_PART.test(p)) score += 3
  }
  return score
}

const PROCESSED_PART =
  /\b(dried|dehydrated|powder|powdered|frozen|canned|mix|mixture|substitute|imitation|meatless|pasteurized|unprepared|restaurant|glutinous|flour|crude)\b/
const PLAIN_PART = /^(whole|raw|fresh|cooked|plain)$/

export async function searchFoods(db: DbAdapter, query: string): Promise<FoodSearch> {
  const words = queryWords(query)
  if (words.length === 0) return { results: [], outcome: 'none' }
  const match = words.map((w) => `"${w}"*`).join(' ')
  const rows = await db.all<{ id: number; name: string; energy_kcal: number | null }>(
    `SELECT f.id AS id, f.name AS name, f.energy_kcal AS energy_kcal
       FROM food_fts JOIN foods f ON f.id = food_fts.rowid
      WHERE food_fts MATCH ?
      ORDER BY bm25(food_fts)
      LIMIT ${CANDIDATES}`,
    [match],
  )
  const seen = new Set<string>()
  const ranked = rows
    .map((r, i) => ({ r, i, score: rankName(r.name, words) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
  const results: FoodHit[] = []
  for (const { r } of ranked) {
    const key = r.name.trim().toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ foodId: Number(r.id), name: r.name, energyKcal: r.energy_kcal ?? null })
    if (results.length === MAX_RESULTS) break
  }
  return { results, outcome: results.length === 0 ? 'none' : results.length === 1 ? 'best' : 'many' }
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
