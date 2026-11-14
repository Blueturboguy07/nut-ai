import { describe, expect, it } from 'vitest'
import { isAdult } from './adult'

const NOV_13_2026 = Date.UTC(2026, 10, 13)

describe('isAdult (no plan screen for a minor)', () => {
  it('an unknown age is not an adult', () => {
    expect(isAdult({ birthYear: null }, NOV_13_2026)).toBe(false)
    expect(isAdult({ birthYear: undefined }, NOV_13_2026)).toBe(false)
  })

  it('a full birth date gives the exact age', () => {
    expect(isAdult({ birthYear: 2008, birthMonth: 11, birthDay: 13 }, NOV_13_2026)).toBe(true)
    expect(isAdult({ birthYear: 2008, birthMonth: 11, birthDay: 14 }, NOV_13_2026)).toBe(false)
    expect(isAdult({ birthYear: 2012, birthMonth: 1, birthDay: 1 }, NOV_13_2026)).toBe(false)
  })

  it('a year alone counts the latest birthday of that year', () => {
    expect(isAdult({ birthYear: 2008 }, NOV_13_2026)).toBe(false)
    expect(isAdult({ birthYear: 2007 }, NOV_13_2026)).toBe(true)
    expect(isAdult({ birthYear: 2008 }, Date.UTC(2026, 11, 31))).toBe(true)
  })
})
