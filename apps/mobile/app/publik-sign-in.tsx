import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { PUBLIK_GATE_MODE } from '../src/build-flags'
import { applyChoice, gateUI, GateView, type Shown } from '../src/components/PublikGate'
import { runPublikSignIn } from '../src/inference/publik'

/**
 * Sign in with publik when the person asks for it (optional mode): from the
 * AI plan choice (onboarding, Profile → AI provider) or Profile → publik
 * account. The same gate screens and words as the required-mode wall, with
 * "Not now" to leave. Usage counting starts only after the sign-in.
 *
 * A required build passed the gate before any screen, so there is nothing to
 * ask here: the screen leaves at once (no spinner). Leaving goes back, or to
 * the home screen when there is nothing to go back to (a deep link).
 */
function leave(): void {
  if (router.canGoBack()) router.back()
  else router.replace('/' as never)
}

export default function PublikSignIn() {
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(() => {
    let alive = true
    let dispose = () => {}
    const done = () => {
      if (!alive) return
      alive = false
      leave()
    }
    if (PUBLIK_GATE_MODE === 'required') {
      done()
    } else {
      const gate = gateUI(setShown)
      dispose = gate.dispose
      runPublikSignIn(gate.ui)
        .then(async (r) => {
          if (r.chosen && r.choice) await applyChoice(r.choice).catch(() => undefined)
          done()
        })
        // The screen closed, or something the gate did not expect: leave, never a spinner.
        .catch(() => done())
    }
    return () => {
      alive = false
      dispose()
    }
  }, [])

  return <GateView shown={shown} onClose={leave} />
}
