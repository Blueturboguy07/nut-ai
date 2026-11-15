/**
 * The onboarding flow, as data.
 *
 * Keeping the order in one place is what makes the progress bar honest: every
 * screen derives its own position from this array rather than hardcoding a
 * number, so inserting or removing a screen can never leave the bar lying.
 */
export const FLOW = [
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

export type Step = (typeof FLOW)[number]

export const TOTAL_STEPS = FLOW.length

export function stepIndex(step: Step): number {
  return FLOW.indexOf(step) + 1
}

export function nextRoute(step: Step): string {
  const i = FLOW.indexOf(step)
  const next = FLOW[i + 1]
  return next ? `/onboarding/${next}` : '/onboarding/plan'
}
