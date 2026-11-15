import { router } from 'expo-router'
import { ScrollView } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { OptionCard } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'

export default function ProfessionalScreen() {
  const a = useAnswers()
  return (
    <OnboardingScreen
      step={stepIndex('professional')}
      total={TOTAL_STEPS}
      title="Do you currently work with a personal trainer or registered dietitian?"
      // No subtitle (App Store 2.1, Nov 14 2026): the shareable export and the
      // coaching it promised are not built. The answer is saved only.
      ctaDisabled={a.worksWithProfessional == null}
      onCta={() => router.push(nextRoute('professional') as never)}
    >
      <ScrollView scrollEnabled={false}>
        <OptionCard
          label="Yes"
          glyph="thumbUp"
          selected={a.worksWithProfessional === true}
          onPress={() => setAnswer('worksWithProfessional', true)}
        />
        <OptionCard
          label="No"
          glyph="thumbDown"
          selected={a.worksWithProfessional === false}
          onPress={() => setAnswer('worksWithProfessional', false)}
        />
      </ScrollView>
    </OnboardingScreen>
  )
}
