/**
 * Is this person an adult for sure? The publik plan screen (Get a plan,
 * Connect your plan) and the publik API offer are never shown to a minor, so
 * an unknown age counts as "not an adult", and a missing month or day counts
 * as the latest birthday of that year (the youngest the person can be).
 */
export const ADULT_AGE = 18

export function isAdult(
  birth: { birthYear: number | null | undefined; birthMonth?: number | null; birthDay?: number | null },
  todayMs: number,
): boolean {
  const y = birth.birthYear
  if (typeof y !== 'number' || !Number.isFinite(y)) return false
  const now = new Date(todayMs)
  const m = birth.birthMonth ?? 12
  const d = birth.birthDay ?? 31
  let age = now.getUTCFullYear() - y
  const monthNow = now.getUTCMonth() + 1
  if (monthNow < m || (monthNow === m && now.getUTCDate() < d)) age--
  return age >= ADULT_AGE
}
