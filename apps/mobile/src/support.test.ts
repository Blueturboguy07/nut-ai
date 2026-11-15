import { describe, expect, it } from 'vitest'
import { APP_VERSION, isSafePublikLink } from './inference/publik-core'
import { REPORT_REASONS, isSupportSource, supportUrl } from './support'

describe('support and Report a wrong result', () => {
  it('opens publik in-app support page with the app and the reason only', () => {
    expect(supportUrl({ source: 'profile' })).toBe(`https://publikhq.com/in-app/support?app=nut-ai&version=${APP_VERSION}&source=profile`)
    expect(supportUrl({ source: 'result', reason: 'wrong_amount' })).toBe(
      `https://publikhq.com/in-app/support?app=nut-ai&version=${APP_VERSION}&source=result&reason=wrong_amount`,
    )
    for (const r of REPORT_REASONS) {
      const url = supportUrl({ source: 'result', reason: r.id })
      expect(isSafePublikLink(url)).toBe(true)
      // No photo and no meal data: only these four query keys.
      expect([...new URL(url).searchParams.keys()].sort()).toEqual(['app', 'reason', 'source', 'version'])
    }
  })

  it('has a short reason picker and known sources only', () => {
    expect(REPORT_REASONS.map((r) => r.label)).toEqual(['Wrong food', 'Wrong amount', 'Wrong calories or nutrients', 'Something else'])
    expect(isSupportSource('result')).toBe(true)
    expect(isSupportSource('exercise')).toBe(true)
    expect(isSupportSource('photo')).toBe(false)
    expect(isSupportSource(undefined)).toBe(false)
  })
})
