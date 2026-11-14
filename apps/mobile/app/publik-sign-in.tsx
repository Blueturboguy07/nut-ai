import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { applyChoice, gateUI, GateView, type Shown } from '../src/components/PublikGate'
import { runPublikSignIn } from '../src/inference/publik'

/**
 * Sign in with publik when the person asks for it (optional mode): from the
 * AI plan choice (onboarding, Profile → AI provider) or Profile → publik
 * account. The same gate screens and words as the required-mode wall, with
 * "Not now" to leave. Usage counting starts only after the sign-in.
 */
export default function PublikSignIn() {
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(() => {
    let alive = true
    const leave = () => {
      if (alive && router.canGoBack()) router.back()
    }
    const { ui, dispose } = gateUI(setShown)
    runPublikSignIn(ui)
      .then(async (gate) => {
        if (gate.chosen && gate.choice) await applyChoice(gate.choice).catch(() => undefined)
        leave()
      })
      .catch(() => undefined)
    return () => {
      alive = false
      dispose()
    }
  }, [])

  return <GateView shown={shown} onClose={() => router.canGoBack() && router.back()} />
}
