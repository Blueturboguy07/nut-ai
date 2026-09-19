import { router } from 'expo-router'
import { useState } from 'react'
import { type ProviderId } from '@nutai/prompt'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { CredentialForm, PROVIDER_NAME } from '../../src/components/CredentialForm'
import { explainProvision, PublikCard, PublikDisclosureBody } from '../../src/components/PublikDisclosure'
import { putSetting, recordConsent } from '../../src/data/repo'
import { connectPublik, publikBuildConfig } from '../../src/inference/publik'
import type { ProvisionResult } from '../../src/inference/publik-core'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'

/**
 * Key entry during onboarding — a thin shell around the shared CredentialForm,
 * which owns the two Anthropic credential shapes, the six named failure
 * states, and the persistence of provider/provider_model. The SAME component
 * runs in Settings, so "works in onboarding, broken in settings" cannot
 * happen by drift.
 *
 * On publik mode the same slot in the flow holds the publik disclosure, and
 * after the mint the first-run card (balance, justification, the link
 * button). The mint is the consent event: it runs only when the user taps
 * "Continue with publik API", never at launch.
 */
export default function ApiKeyScreen() {
  const a = useAnswers()
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<Extract<ProvisionResult, { ok: true }> | null>(null)

  if (a.provider === 'publik') {
    if (minted) {
      return (
        <OnboardingScreen
          step={stepIndex('apikey')}
          total={TOTAL_STEPS}
          title="publik API is ready"
          subtitle="Your first scans run on the free starter. Link this phone whenever you want a plan — or never."
          cta="Continue"
          onCta={() => router.push(nextRoute('apikey') as never)}
          scroll
        >
          <PublikCard install={minted.install} wallet={minted.wallet} starterMicros={minted.starterMicros} />
        </OnboardingScreen>
      )
    }
    return (
      <OnboardingScreen
        step={stepIndex('apikey')}
        total={TOTAL_STEPS}
        title="Nut AI uses publik API"
        subtitle="Photo scans need an AI model. By default they run on publik API, so you can start right away without an account or a key."
        cta={busy ? 'Connecting…' : 'Continue with publik API'}
        ctaDisabled={busy}
        onCta={() => {
          if (busy) return
          setBusy(true)
          setError(null)
          void (async () => {
            const r = await connectPublik()
            if (!r.ok) {
              setBusy(false)
              setError(explainProvision(r))
              return
            }
            const scanModel = publikBuildConfig().models.scan
            setAnswer('providerModel', scanModel)
            await putSetting('provider', 'publik')
            await putSetting('provider_model', scanModel)
            await recordConsent('publik.disclosure', String(r.install.disclosureVersion))
            setBusy(false)
            setMinted(r)
          })()
        }}
        secondaryLabel={busy ? undefined : 'Use my own key instead'}
        onSecondary={() => {
          setAnswer('provider', undefined)
          router.back()
        }}
        scroll
      >
        <PublikDisclosureBody error={error} />
      </OnboardingScreen>
    )
  }

  const provider = (a.provider && a.provider !== 'none' ? a.provider : 'anthropic') as ProviderId

  return (
    <OnboardingScreen
      step={stepIndex('apikey')}
      total={TOTAL_STEPS}
      title={`Connect ${PROVIDER_NAME[provider]}`}
      subtitle={`We'll check the key works before saving it. It is stored in the iOS Keychain and sent only to ${PROVIDER_NAME[provider]}.`}
      cta="Continue"
      onCta={() => router.push(nextRoute('apikey') as never)}
      ctaDisabled={!saved}
      secondaryLabel={saved ? undefined : 'Skip for now'}
      onSecondary={() => {
        setAnswer('provider', 'none')
        void putSetting('provider', 'none')
        router.push(nextRoute('apikey') as never)
      }}
      scroll
    >
      <CredentialForm
        provider={provider}
        onSaved={(modelId) => {
          setAnswer('providerModel', modelId)
          setSaved(true)
        }}
      />
    </OnboardingScreen>
  )
}
