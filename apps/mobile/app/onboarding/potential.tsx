import { router } from 'expo-router'
import { Text, View } from 'react-native'
import { TransitionChart } from '../../src/components/onboarding/Charts'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { potentialCopy } from '../../src/onboarding/goal-copy'
import { inferredGoal, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * How weight changes, in plain words that follow the goal.
 *
 * Blind test round 1, Nov 14 2026 (B6): this step said "You have great
 * potential to crush your goal" with a weight-loss curve, also for "Maintain".
 * Now there is no promise; the words come from src/onboarding/goal-copy.ts,
 * and the projected curve shows only when the goal is to lose weight, labeled
 * "Estimate, not a promise".
 */
export default function PotentialScreen() {
  const theme = useTheme()
  const a = useAnswers()
  const copy = potentialCopy(inferredGoal(a))
  return (
    <OnboardingScreen
      step={stepIndex('potential')}
      total={TOTAL_STEPS}
      title={copy.title}
      onCta={() => router.push(nextRoute('potential') as never)}
      scroll
    >
      <View style={{ padding: space.lg, borderRadius: radius.xl, backgroundColor: theme.bgSunken }}>
        <Text style={[type.body, { color: theme.text, lineHeight: 23 }]}>{copy.body}</Text>
      </View>
      {copy.showProjection ? (
        <View style={{ marginTop: space.lg }}>
          <TransitionChart />
        </View>
      ) : null}
    </OnboardingScreen>
  )
}
