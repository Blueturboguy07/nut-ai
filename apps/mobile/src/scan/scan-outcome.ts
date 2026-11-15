/**
 * What a meal scan says when the model's answer cannot be used, and when it
 * does the one automatic retry. Pure: no React Native, so it is tested in
 * node (scan-outcome.test.ts); src/scan/orchestrator.ts uses it.
 *
 * Blind test round 1 (Nov 14 2026, B7): an answer in a shape the app could
 * not read said "This one is on us — try once more", which was not true (the
 * call counted). Now:
 *
 *   1. The answer is not usable (no JSON, the wrong JSON): the app asks again
 *      ONCE, by itself, with a stricter format (STRICT_FORMAT_BLOCK in
 *      @nutai/prompt). This is not the retry of an unknown result: the first
 *      call finished, and its answer is in hand.
 *   2. Still not usable: a plain message, with Try again. No promise about
 *      cost.
 *   3. The model says there is no food: "No food found in this photo."
 *
 * A timeout or a dropped connection is NEVER retried here (the call may still
 * run and count; pathA/client.ts says so to the person).
 */

/** Where the meal came from: a photo, or the words of "Describe a meal". */
export type MealInput = 'photo' | 'text'

export const UNREADABLE_PHOTO_MESSAGE = 'We could not read this photo. Try again or describe the meal.'
export const UNREADABLE_TEXT_MESSAGE = 'We could not read the estimate for this description. Try again, or use other words.'
export const NO_FOOD_PHOTO_MESSAGE = 'No food found in this photo.'
export const NO_FOOD_TEXT_MESSAGE = 'No food found in this description. Name the food and drink, for example “2 eggs and a slice of toast”.'
export const FOOD_DB_FAILED_MESSAGE = 'The food database did not answer. Close the app, open it again, and try again.'

export function unreadableMessage(input: MealInput): string {
  return input === 'photo' ? UNREADABLE_PHOTO_MESSAGE : UNREADABLE_TEXT_MESSAGE
}

export function noFoodMessage(input: MealInput): string {
  return input === 'photo' ? NO_FOOD_PHOTO_MESSAGE : NO_FOOD_TEXT_MESSAGE
}

/**
 * After one model call: go on, ask again once with the stricter format, or
 * stop with the plain "could not read" message.
 *
 *   callOk        the call answered (HTTP 200 and an answer in hand)
 *   failureKind   the failure's kind when it did not
 *   payloadValid  the answer matched the meal schema (validatePayload)
 *   strict        this call already was the one retry
 */
export function afterModelCall(a: {
  callOk: boolean
  failureKind?: string
  payloadValid: boolean
  strict: boolean
}): 'continue' | 'retry-strict' | 'unreadable' | 'failure' {
  if (!a.callOk) {
    // Only an answer in a shape the app could not read; every other failure
    // (limit, key, network, timeout, a cut-short answer) keeps its own words.
    if (a.failureKind !== 'schema-violation') return 'failure'
    return a.strict ? 'unreadable' : 'retry-strict'
  }
  if (a.payloadValid) return 'continue'
  return a.strict ? 'unreadable' : 'retry-strict'
}

/**
 * The model answered with food (is_food) but listed no item: as good as no
 * food for the person.
 */
export function foundNoFood(r: { isFood: boolean; itemCount: number }): boolean {
  return !r.isFood || r.itemCount === 0
}
