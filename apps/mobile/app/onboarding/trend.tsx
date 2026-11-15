import { router } from 'expo-router'
import { Text, View } from 'react-native'
import { Icon } from '../../src/components/Icon'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { trendCopy } from '../../src/onboarding/goal-copy'
import { inferredGoal, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * What logging shows you, for the person's goal.
 *
 * Blind test round 1, Nov 14 2026 (B6): this step showed a chart of "this app"
 * against "Without a plan". That is an ad, not a fact about this person, so it
 * is gone. The facts come from src/onboarding/goal-copy.ts.
 */
export default function TrendScreen() {
  const theme = useTheme()
  const a = useAnswers()
  const copy = trendCopy(inferredGoal(a))
  return (
    <OnboardingScreen
      step={stepIndex('trend')}
      total={TOTAL_STEPS}
      title={copy.title}
      onCta={() => router.push(nextRoute('trend') as never)}
      scroll
    >
      <View style={{ padding: space.lg, borderRadius: radius.xl, backgroundColor: theme.bgSunken, gap: space.md }}>
        {copy.facts.map((f) => (
          <View key={f} style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <View style={{ marginTop: 2 }}>
              <Icon name="check" size={18} color={theme.text} weight={2.2} />
            </View>
            <Text style={[type.body, { color: theme.text, flex: 1, lineHeight: 23 }]}>{f}</Text>
          </View>
        ))}
      </View>
    </OnboardingScreen>
  )
}
