/**
 * A timer that aborts one fetch and remembers that it did.
 *
 * On a phone the global `fetch` is expo/fetch: Expo 57 installs it before the
 * app's own code (expo/src/winter, unless EXPO_PUBLIC_USE_RN_FETCH is set,
 * which this app never sets). When its signal aborts, the call rejects with
 * expo's FetchError ("fetch failed: Fetch request has been canceled"), whose
 * `name` is plain "Error", not "AbortError" as in browsers and Node. A check
 * on the error's name therefore read every timeout on a phone as a dropped
 * connection: "check the connection" and a Retry button for a call that was
 * most likely charged (blind verify, Nov 2 2026).
 *
 * So whether a call timed out is answered from this timer's own state, never
 * from the error. A call that rejects after the timer fired timed out,
 * whatever it threw; a call that rejects before it did not.
 */
export interface Deadline {
  /** Pass to fetch. */
  readonly signal: AbortSignal
  /** True once the timer fired and aborted the call. */
  readonly timedOut: boolean
  /** Stop the timer once the call is settled. */
  clear(): void
}

export function startDeadline(ms: number): Deadline {
  const controller = new AbortController()
  let fired = false
  const timer = setTimeout(() => {
    fired = true
    controller.abort()
  }, ms)
  return {
    signal: controller.signal,
    get timedOut() {
      return fired
    },
    clear: () => clearTimeout(timer),
  }
}
