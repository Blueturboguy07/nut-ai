import { router } from 'expo-router'
import { ScrollView } from 'react-native'
import { nextRoute, stepIndex, TOTAL_STEPS, type Step } from '../../onboarding/flow'
import { setAnswer, useAnswers, type OnboardingAnswers } from '../../onboarding/store'
import { OnboardingScreen } from './Chrome'
import type { IconName } from '../Icon'
import { OptionCard } from './Controls'

/**
 * Every single-choice screen in the flow.
 *
 * Thirteen of the twenty onboarding screens are the same object: a question, a
 * list of glyph-and-label cards, one selection, one Continue. Writing them
 * thirteen times would guarantee they drift apart — a padding here, a disabled
 * rule there — which is exactly the inconsistency that makes a flow feel cheap.
 */
export interface Option<V extends string> {
  value: V
  label: string
  sublabel?: string
  glyph: IconName
}

export function OptionScreen<K extends keyof OnboardingAnswers>({
  step,
  field,
  title,
  subtitle,
  options,
  scroll = false,
}: {
  step: Step
  field: K
  title: string
  subtitle?: string
  options: ReadonlyArray<Option<Extract<OnboardingAnswers[K], string>>>
  scroll?: boolean
}) {
  const answers = useAnswers()
  const current = answers[field]

  return (
    <OnboardingScreen
      step={stepIndex(step)}
      total={TOTAL_STEPS}
      title={title}
      {...(subtitle ? { subtitle } : {})}
      scroll={scroll}
      // Continue stays disabled until a choice is made:
      // a greyed button is a clearer instruction than an enabled one that does
      // nothing.
      ctaDisabled={current == null}
      onCta={() => router.push(nextRoute(step) as never)}
    >
      <ScrollView scrollEnabled={false} contentContainerStyle={{ paddingBottom: 8 }}>
        {options.map((o) => (
          <OptionCard
            key={o.value}
            label={o.label}
            {...(o.sublabel ? { sublabel: o.sublabel } : {})}
            glyph={o.glyph}
            selected={current === o.value}
            onPress={() => setAnswer(field, o.value as OnboardingAnswers[K])}
          />
        ))}
      </ScrollView>
    </OnboardingScreen>
  )
}
