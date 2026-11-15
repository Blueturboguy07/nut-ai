import type { Goal } from '@nutai/goals'

/**
 * The onboarding words that depend on the goal (lose, maintain or gain).
 *
 * Blind test round 1, Nov 14 2026 (B6): the onboarding said "You have great
 * potential to crush your goal" and showed weight-loss curves, also when the
 * goal was "Maintain". The rules now:
 *
 *   - No promises and no hype. Plain facts about how weight changes.
 *   - The words follow the goal. A person who wants to keep their weight sees
 *     nothing about losing it.
 *   - A projected weight curve shows ONLY when the goal is to lose weight, and
 *     then it carries the label ESTIMATE_NOT_PROMISE.
 *   - A date is never a target ("lose 10 lbs by March 3"). It is an estimate
 *     from the arithmetic at the chosen pace, labeled as one.
 *
 * Pure: no React Native imports, so goal-copy.test.ts runs it in node.
 */

/** The label on every projection (a curve or a date). */
export const ESTIMATE_NOT_PROMISE = 'Estimate, not a promise'

export interface GoalScreenCopy {
  title: string
  body: string
  /** Show the projected weight curve: only for a goal to lose weight. */
  showProjection: boolean
}

/** The "how weight changes" step (app/onboarding/potential.tsx). */
export function potentialCopy(goal: Goal): GoalScreenCopy {
  switch (goal) {
    case 'lose':
      return {
        title: 'Weight changes slowly',
        body:
          'Weight usually goes down over weeks, not days. It goes up and down a little from day to day. The trend over a month tells you more than one day.',
        showProjection: true,
      }
    case 'gain':
      return {
        title: 'Weight changes slowly',
        body:
          'Weight usually goes up over weeks, not days. It goes up and down a little from day to day. The trend over a month tells you more than one day.',
        showProjection: false,
      }
    case 'maintain':
    default:
      return {
        title: 'Keep your weight steady',
        body:
          'Your daily target is close to the energy your body uses. Your weight goes up and down a little from day to day. The trend over a few weeks shows if it stays steady.',
        showProjection: false,
      }
  }
}

/** The "what logging shows you" step (app/onboarding/trend.tsx). */
export function trendCopy(goal: Goal): { title: string; facts: string[] } {
  const energy =
    goal === 'lose'
      ? 'If you eat less energy than you use. That is how weight goes down.'
      : goal === 'gain'
        ? 'If you eat more energy than you use. That is how weight goes up.'
        : 'If you eat about the energy you use. That is how weight stays steady.'
  return {
    title: 'What logging shows you',
    facts: [
      'What you eat each day: calories, protein, carbs and fat.',
      energy,
      'Your weight trend, when you log your weight.',
      'Every number is an estimate. You can correct it.',
    ],
  }
}

/** The plan screen's headline: the goal, with no date in it. */
export function planGoalLine(goal: Goal, deltaLb: number): string {
  const lbs = Math.round(deltaLb)
  if (goal === 'maintain' || lbs < 1) return 'Goal: keep your weight steady'
  return `Goal: ${goal === 'gain' ? 'gain' : 'lose'} ${lbs} lbs`
}

/**
 * The plan screen's date line: when the goal weight comes at the chosen pace,
 * labeled as an estimate. null when the goal is to keep the weight.
 */
export function planDateLine(goal: Goal, deltaLb: number, dateLabel: string): string | null {
  if (goal === 'maintain' || Math.round(deltaLb) < 1) return null
  return `At this pace, about ${dateLabel}. ${ESTIMATE_NOT_PROMISE}.`
}
