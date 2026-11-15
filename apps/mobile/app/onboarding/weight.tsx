import { router } from 'expo-router'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { EditableValue, RulerPicker, Segmented } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { kgToLb, lbToKg, setAnswer, useAnswers } from '../../src/onboarding/store'
import { space } from '../../src/theme/tokens'

const DEFAULT_KG = 88.4 // ~194.9 lbs

export default function WeightScreen() {
  const { width } = useWindowDimensions()
  const a = useAnswers()

  const kg = a.weightKg ?? DEFAULT_KG
  const imperial = a.units === 'imperial'
  const shown = imperial ? kgToLb(kg) : kg
  const min = imperial ? 60 : 30
  const max = imperial ? 500 : 227

  return (
    <OnboardingScreen
      step={stepIndex('weight')}
      total={TOTAL_STEPS}
      title="What is your weight?"
      subtitle="This will be taken into account when calculating your daily nutrition goals."
      onCta={() => {
        if (a.weightKg == null) setAnswer('weightKg', DEFAULT_KG)
        router.push(nextRoute('weight') as never)
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <Segmented
          options={[
            { value: 'imperial', label: 'lbs' },
            { value: 'metric', label: 'kg' },
          ]}
          value={a.units}
          // Switching units converts rather than resetting. Losing the entered
          // value on a unit toggle is a small betrayal that makes people
          // distrust every other control.
          onChange={(u) => setAnswer('units', u)}
        />

        <View style={styles.readout}>
          <EditableValue
            label="Current weight"
            value={shown}
            unit={imperial ? 'lbs' : 'kg'}
            min={min}
            max={max}
            onCommit={(v) => setAnswer('weightKg', imperial ? lbToKg(v) : v)}
          />
        </View>
      </View>

      <View style={{ marginTop: space.lg, marginHorizontal: -space.lg }}>
        <RulerPicker
          width={width}
          min={min}
          max={max}
          step={0.1}
          value={Number(shown.toFixed(1))}
          onChange={(v) => setAnswer('weightKg', imperial ? lbToKg(v) : v)}
        />
      </View>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  readout: { alignItems: 'center', marginTop: 96 },
})
