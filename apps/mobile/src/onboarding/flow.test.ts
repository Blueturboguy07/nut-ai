import { describe, expect, it, vi } from 'vitest'

// The default build: HealthKit is not compiled in (SKIP_HEALTHKIT is not 0).
vi.mock('../health/build', () => ({ HEALTHKIT_IN_BUILD: false }))

import { ALL_STEPS, FLOW, NOT_BUILT, TOTAL_STEPS, flowSteps, nextRoute, stepIndex } from './flow'

describe('onboarding flow: no step for a feature that cannot work (App Store 2.1)', () => {
  it('has no Apple Health step when HealthKit is not in the build', () => {
    expect(FLOW).not.toContain('health')
    expect(stepIndex('health')).toBe(0)
    expect(nextRoute('apikey')).toBe('/onboarding/thanks')
    // A stale link to a left-out step still moves forward, never back to the start.
    expect(nextRoute('health')).toBe('/onboarding/thanks')
    expect(stepIndex('thanks')).toBe(stepIndex('apikey') + 1)
  })

  it('leaves out the steps of unbuilt features (reminders, calorie rollover)', () => {
    expect(NOT_BUILT).toEqual(['rollover', 'notifications'])
    for (const s of NOT_BUILT) expect(FLOW).not.toContain(s)
    expect(TOTAL_STEPS).toBe(ALL_STEPS.length - 3)
    expect(nextRoute('accomplish')).toBe('/onboarding/provider')
    expect(nextRoute('rollover')).toBe('/onboarding/provider')
    expect(nextRoute('thanks')).toBe('/onboarding/generate')
    expect(nextRoute('notifications')).toBe('/onboarding/generate')
  })

  it('has the Apple Health step when HealthKit is in the build', () => {
    const withHealth = flowSteps(true)
    expect(withHealth).toContain('health')
    expect(withHealth.length).toBe(ALL_STEPS.length - NOT_BUILT.length)
    expect(nextRoute('apikey', withHealth)).toBe('/onboarding/health')
    expect(nextRoute('health', withHealth)).toBe('/onboarding/thanks')
  })

  it('ends at the plan screen', () => {
    expect(nextRoute('generate')).toBe('/onboarding/plan')
  })
})
