import { router } from 'expo-router'
import { useMemo } from 'react'
import { View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { Segmented, Wheel, WheelHighlight } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { space } from '../../src/theme/tokens'

const DEFAULT_CM = 168 // 5 ft 6 in

const CM_PER_IN = 2.54

function toFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = Math.round(cm / CM_PER_IN)
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 }
}

export default function HeightScreen() {
  const a = useAnswers()
  const cm = a.heightCm ?? DEFAULT_CM
  const imperial = a.units === 'imperial'
  const { ft, inch } = toFtIn(cm)

  const feet = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ value: i + 2, label: `${i + 2} ft` })),
    [],
  )
  const inches = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ value: i, label: `${i} in` })),
    [],
  )
  const cms = useMemo(
    () => Array.from({ length: 151 }, (_, i) => ({ value: i + 100, label: `${i + 100} cm` })),
    [],
  )

  return (
    <OnboardingScreen
      step={stepIndex('height')}
      total={TOTAL_STEPS}
      title="What is your height?"
      subtitle="This will be taken into account when calculating your daily nutrition goals."
      onCta={() => {
        if (a.heightCm == null) setAnswer('heightCm', DEFAULT_CM)
        router.push(nextRoute('height') as never)
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <Segmented
          options={[
            { value: 'imperial', label: 'ft, in' },
            { value: 'metric', label: 'cm' },
          ]}
          value={a.units}
          onChange={(u) => setAnswer('units', u)}
        />
      </View>

      <View style={{ marginTop: 88 }}>
        <WheelHighlight>
          {imperial ? (
            <>
              <Wheel
                label="Feet"
                items={feet}
                value={ft}
                width={140}
                onChange={(v) => setAnswer('heightCm', (v * 12 + inch) * CM_PER_IN)}
              />
              <Wheel
                label="Inches"
                items={inches}
                value={inch}
                width={140}
                onChange={(v) => setAnswer('heightCm', (ft * 12 + v) * CM_PER_IN)}
              />
            </>
          ) : (
            <Wheel
              label="Centimetres"
              items={cms}
              value={Math.round(cm)}
              width={space.xxxl * 4}
              onChange={(v) => setAnswer('heightCm', v)}
            />
          )}
        </WheelHighlight>
      </View>
    </OnboardingScreen>
  )
}
