import type { DbAdapter } from '@nutai/db-adapter'
import { foodFacts } from './food-amount'
import type { ManualFoodSelection } from './manual-food'

/**
 * What "select this food" means, computed from the (read-only) nutrition
 * corpus alone, at the DEFAULT serving (food-amount.ts: a large egg, a medium
 * banana, ...). The Food Database screen now shows an amount step first
 * (blind test round 2, N4) and logs the amount the person picks; this is the
 * same choice without the step, kept for the tests and any caller that has
 * no amount. ZERO React Native imports, so it runs under bare Node.
 */
export async function resolveSelection(
  nutritionDb: DbAdapter,
  candidate: { foodId: string | number; name: string },
): Promise<ManualFoodSelection> {
  const foodId = Number(candidate.foodId)
  const facts = await foodFacts(nutritionDb, foodId)
  if (!facts) {
    return {
      foodId,
      displayName: candidate.name,
      grams: 100,
      nutrientSnapshot: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: null, sugar_g: null, sodium_mg: null },
    }
  }
  return {
    foodId,
    displayName: candidate.name,
    grams: facts.servings[facts.defaultIndex]!.grams,
    nutrientSnapshot: facts.per100,
  }
}
