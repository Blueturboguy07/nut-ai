import { HEALTHKIT_IN_BUILD } from '../health/build'

/**
 * The onboarding flow, as data.
 *
 * Keeping the order in one place is what makes the progress bar honest: every
 * screen derives its own position from this array rather than hardcoding a
 * number, so inserting or removing a screen can never leave the bar lying.
 */
export const ALL_STEPS = [
  'sex',
  'workouts',
  'birth',
  'height',
  'weight',
  // No 'goal' screen. Direction is DERIVED from current vs desired weight — see
  // inferredGoal(). Asking after both numbers are known can only produce
  // agreement or a contradiction the app then has to resolve silently.
  'desired-weight',
  // 'trend' sits after the weights so its curve can follow the real direction.
  // A decline drawn unconditionally would be wrong for a bulk.
  'trend',
  'professional',
  'potential',
  'blocker',
  'diet',
  'accomplish',
  'rollover',
  // Path A setup. Placed after the plan-shaping questions and before first
  // camera use, so the named destination is consented to before any photo could
  // leave the device.
  'provider',
  'apikey',
  'health',
  'thanks',
  'notifications',
  'generate',
] as const

export type Step = (typeof ALL_STEPS)[number]

/**
 * Steps of features that are not built yet: reminders ('notifications') and
 * calorie rollover ('rollover'). They stay out of the flow until the feature
 * works (App Store 2.1: no screen for a feature that cannot work).
 */
export const NOT_BUILT: readonly Step[] = ['rollover', 'notifications']

/** The steps of this build: no unbuilt feature, and no Apple Health step when HealthKit is not in the build. */
export function flowSteps(healthKit: boolean): readonly Step[] {
  return ALL_STEPS.filter((s) => !NOT_BUILT.includes(s) && (s !== 'health' || healthKit))
}

export const FLOW: readonly Step[] = flowSteps(HEALTHKIT_IN_BUILD)

export const TOTAL_STEPS = FLOW.length

/** The 1-based position in this build's flow (0 for a step this build leaves out). */
export function stepIndex(step: Step): number {
  return FLOW.indexOf(step) + 1
}

/** The next step of this build's flow after `step`, also from a step this build leaves out. */
export function nextRoute(step: Step, flow: readonly Step[] = FLOW): string {
  const i = ALL_STEPS.indexOf(step)
  const next = ALL_STEPS.slice(i + 1).find((s) => flow.includes(s))
  return next ? `/onboarding/${next}` : '/onboarding/plan'
}
