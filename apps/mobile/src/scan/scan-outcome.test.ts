import { describe, expect, it } from 'vitest'
import {
  afterModelCall,
  foundNoFood,
  NO_FOOD_PHOTO_MESSAGE,
  noFoodMessage,
  UNREADABLE_PHOTO_MESSAGE,
  unreadableMessage,
} from './scan-outcome'

describe('an answer the app cannot read (blind test round 1, B7)', () => {
  it('asks again once, with the stricter format, then stops', () => {
    expect(afterModelCall({ callOk: true, payloadValid: false, strict: false })).toBe('retry-strict')
    expect(afterModelCall({ callOk: true, payloadValid: false, strict: true })).toBe('unreadable')
    expect(afterModelCall({ callOk: false, failureKind: 'schema-violation', payloadValid: false, strict: false })).toBe('retry-strict')
    expect(afterModelCall({ callOk: false, failureKind: 'schema-violation', payloadValid: false, strict: true })).toBe('unreadable')
  })

  it('a usable answer goes on', () => {
    expect(afterModelCall({ callOk: true, payloadValid: true, strict: false })).toBe('continue')
    expect(afterModelCall({ callOk: true, payloadValid: true, strict: true })).toBe('continue')
  })

  it('never retries a timeout, a dropped call, a limit, a key error or a cut-short answer', () => {
    for (const kind of ['timeout-ambiguous', 'offline', 'quota-exhausted', 'key-invalid', 'output-truncated', 'error-retryable', 'content-refusal']) {
      expect(afterModelCall({ callOk: false, failureKind: kind, payloadValid: false, strict: false })).toBe('failure')
    }
  })

  it('says it plainly, with no promise about cost', () => {
    expect(unreadableMessage('photo')).toBe('We could not read this photo. Try again or describe the meal.')
    expect(UNREADABLE_PHOTO_MESSAGE).not.toMatch(/on us|free|charge|cost/i)
    expect(unreadableMessage('text')).not.toMatch(/photo/i)
  })
})

describe('no food', () => {
  it('a photo with no food, or no item, says "No food found in this photo."', () => {
    expect(foundNoFood({ isFood: false, itemCount: 0 })).toBe(true)
    expect(foundNoFood({ isFood: true, itemCount: 0 })).toBe(true)
    expect(foundNoFood({ isFood: true, itemCount: 2 })).toBe(false)
    expect(noFoodMessage('photo')).toBe(NO_FOOD_PHOTO_MESSAGE)
    expect(NO_FOOD_PHOTO_MESSAGE).toBe('No food found in this photo.')
    expect(noFoodMessage('text')).toMatch(/^No food found in this description\./)
  })
})
