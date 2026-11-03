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
 *
 * The abort does not end the BODY read on a phone (blind verify r7, expo
 * 57.0.9 native code). Once the headers are in, text(), json() and
 * arrayBuffer() wait only for the native "body completed" state:
 * - iOS (ExpoFetchModule.swift): the cancel sets an error state, and the later
 *   "completed" callback returns early, so the read NEVER settles.
 * - Android (ExpoFetchModule.kt, NativeResponse.kt): the body pump catches the
 *   cancel and marks the body completed anyway, so text() RESOLVES with the
 *   bytes read so far (often ""), and json() throws a SyntaxError.
 * So every fetch and every body read goes through `within`: it gives up at
 * the deadline whatever the read does, and the caller reports a timeout.
 */
export interface Deadline {
  /** Pass to fetch. */
  readonly signal: AbortSignal
  /** True once the timer fired and aborted the call. */
  readonly timedOut: boolean
  /**
   * Waits for `work` (the fetch, or res.text() / res.json() / res.arrayBuffer())
   * but never past the deadline. Before the timer fires, it settles as `work`
   * does. Once the timer fires, it rejects with DeadlineExceeded at once, and
   * also when `work` settles later with a value or an error: a body cut by the
   * abort is not an answer.
   */
  within<T>(work: PromiseLike<T> | T): Promise<T>
  /** Stop the timer once the call is settled. */
  clear(): void
}

/** What `Deadline.within` rejects with once the timer fired. */
export class DeadlineExceeded extends Error {
  constructor() {
    super('No complete answer before the deadline.')
    this.name = 'DeadlineExceeded'
  }
}

export function startDeadline(ms: number): Deadline {
  const controller = new AbortController()
  let fired = false
  // The pending `within` calls. The timer ends them itself, so this does not
  // depend on how the platform's AbortSignal delivers its 'abort' event.
  const waiting = new Set<() => void>()
  const timer = setTimeout(() => {
    fired = true
    // First the abort, so expo cancels the native request; then the waits.
    controller.abort()
    Array.from(waiting).forEach((giveUp) => giveUp())
  }, ms)

  function within<T>(work: PromiseLike<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const giveUp = () => {
        waiting.delete(giveUp)
        reject(new DeadlineExceeded())
      }
      // Always handled, so a read that rejects late is never "unhandled".
      Promise.resolve(work).then(
        (value) => {
          waiting.delete(giveUp)
          if (fired) reject(new DeadlineExceeded())
          else resolve(value)
        },
        (error: unknown) => {
          waiting.delete(giveUp)
          reject(fired ? new DeadlineExceeded() : error)
        },
      )
      if (fired) giveUp()
      else waiting.add(giveUp)
    })
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return fired
    },
    within,
    clear: () => clearTimeout(timer),
  }
}
