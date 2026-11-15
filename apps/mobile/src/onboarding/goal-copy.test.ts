import { describe, expect, it } from 'vitest'
import type { Goal } from '@nutai/goals'
import { ESTIMATE_NOT_PROMISE, planDateLine, planGoalLine, potentialCopy, trendCopy } from './goal-copy'

/** Blind test round 1, Nov 14 2026 (B6): no promises, words that follow the goal. */

const GOALS: Goal[] = ['lose', 'maintain', 'gain']
const HYPE = /potential|crush|guarantee|transform|you will|results|without a plan/i

function allText(goal: Goal): string {
  const p = potentialCopy(goal)
  const t = trendCopy(goal)
  return [p.title, p.body, t.title, ...t.facts, planGoalLine(goal, 10), planDateLine(goal, 10, 'March 3') ?? ''].join(' ')
}

describe('onboarding goal words', () => {
  it('make no promises for any goal', () => {
    for (const g of GOALS) expect(allText(g)).not.toMatch(HYPE)
  })

  it('show a projected weight curve only for a goal to lose weight', () => {
    expect(potentialCopy('lose').showProjection).toBe(true)
    expect(potentialCopy('maintain').showProjection).toBe(false)
    expect(potentialCopy('gain').showProjection).toBe(false)
  })

  it('say nothing about losing or gaining weight when the goal is to maintain', () => {
    const text = allText('maintain')
    expect(text).not.toMatch(/\blos(e|ing)\b|goes down|\bgain/i)
    expect(text).toMatch(/steady/)
  })

  it('give the goal without a date, and the date only as a labeled estimate', () => {
    expect(planGoalLine('lose', 12.4)).toBe('Goal: lose 12 lbs')
    expect(planGoalLine('gain', 5)).toBe('Goal: gain 5 lbs')
    expect(planGoalLine('maintain', 0)).toBe('Goal: keep your weight steady')
    expect(planGoalLine('lose', 0.2)).toBe('Goal: keep your weight steady')
    for (const g of GOALS) expect(planGoalLine(g, 10)).not.toMatch(/\bby\b/)
    expect(planDateLine('lose', 12, 'March 3')).toBe(`At this pace, about March 3. ${ESTIMATE_NOT_PROMISE}.`)
    expect(planDateLine('maintain', 12, 'March 3')).toBeNull()
    expect(ESTIMATE_NOT_PROMISE).toBe('Estimate, not a promise')
  })
})
