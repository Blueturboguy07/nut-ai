import { rangeFor, type Band } from '@nutai/confidence'

/**
 * The plain sentence under an AI estimate's calories on the result screen
 * (blind test round 2, Nov 15 2026, N3: "say plainly in the UI that it is an
 * estimate with a range"). null when the number is not an estimate (a
 * printed label: the band has no width). Pure, for the tests.
 */
export function estimateRangeSentence(kcal: number, band: Band): string | null {
  if (band.tier === 'none' || !Number.isFinite(kcal) || kcal <= 0) return null
  const { low, high } = rangeFor(kcal, band)
  return `This is an estimate, not a measurement. The true value is probably between ${Math.round(low)} and ${Math.round(high)} kcal.`
}
