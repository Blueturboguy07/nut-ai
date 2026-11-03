import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeadlineExceeded, startDeadline } from './deadline'

/** Resolves `value` after `ms` of fake time. */
const after = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Deadline.within', () => {
  it('settles as the work does before the deadline: a value, or the same error', async () => {
    const d = startDeadline(1_000)
    const value = d.within(after(500, 'body'))
    await vi.advanceTimersByTimeAsync(500)
    await expect(value).resolves.toBe('body')
    const dropped = new Error('Network request failed')
    await expect(d.within(Promise.reject(dropped))).rejects.toBe(dropped)
    expect(d.timedOut).toBe(false)
    d.clear()
  })

  it('takes a plain value too', async () => {
    const d = startDeadline(1_000)
    await expect(d.within('now')).resolves.toBe('now')
    d.clear()
  })

  it('gives up at the deadline when the work never settles (iOS body read), after the abort', async () => {
    const d = startDeadline(1_000)
    const order: string[] = []
    d.signal.addEventListener('abort', () => order.push('abort'))
    const read = d.within(new Promise<string>(() => {})).catch((e: unknown) => {
      order.push('gave up')
      throw e
    })
    let settled = false
    void read.then(
      () => (settled = true),
      () => (settled = true),
    )
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(read).rejects.toBeInstanceOf(DeadlineExceeded)
    expect(d.timedOut).toBe(true)
    expect(d.signal.aborted).toBe(true)
    expect(order).toEqual(['abort', 'gave up'])
  })

  it('rejects when the work resolves after the deadline fired (Android: the bytes so far)', async () => {
    const d = startDeadline(1_000)
    const read = expect(
      d.within(new Promise<string>((resolve) => d.signal.addEventListener('abort', () => queueMicrotask(() => resolve('{"items":[]}'))))),
    ).rejects.toBeInstanceOf(DeadlineExceeded)
    await vi.advanceTimersByTimeAsync(1_000)
    await read
  })

  it('a call made after the deadline fired rejects at once, and a late rejection of the work is handled', async () => {
    const d = startDeadline(10)
    await vi.advanceTimersByTimeAsync(10)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      await expect(d.within(Promise.resolve('late'))).rejects.toBeInstanceOf(DeadlineExceeded)
      await expect(d.within(after(5, 'later'))).rejects.toBeInstanceOf(DeadlineExceeded)
      const lateError = d.within(Promise.reject(new SyntaxError('Unexpected end of JSON input')))
      await expect(lateError).rejects.toBeInstanceOf(DeadlineExceeded)
      await vi.advanceTimersByTimeAsync(5)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('every pending wait gives up at the one deadline', async () => {
    const d = startDeadline(1_000)
    const fetchCall = expect(d.within(new Promise(() => {}))).rejects.toBeInstanceOf(DeadlineExceeded)
    const bodyRead = expect(d.within(new Promise(() => {}))).rejects.toBeInstanceOf(DeadlineExceeded)
    await vi.advanceTimersByTimeAsync(1_000)
    await fetchCall
    await bodyRead
  })

  it('clear() stops the timer: a call that finished in time never times out later', async () => {
    const d = startDeadline(1_000)
    await expect(d.within(Promise.resolve('ok'))).resolves.toBe('ok')
    d.clear()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(d.timedOut).toBe(false)
    expect(d.signal.aborted).toBe(false)
  })
})
