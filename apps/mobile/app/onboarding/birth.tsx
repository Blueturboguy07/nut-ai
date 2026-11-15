import { router } from 'expo-router'
import { useMemo } from 'react'
import { View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { Wheel, WheelHighlight } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Days in a month, so 31 February can never be selected. */
function daysIn(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export default function BirthScreen() {
  const a = useAnswers()

  // A fixed current year keeps this deterministic and avoids reading the clock
  // during render. Defaults land on a plausible adult, never on this year
  // (which would be a zero-year-old).
  const thisYear = 2026
  const year = a.birthYear ?? 2000
  const month = a.birthMonth ?? 1
  const day = a.birthDay ?? 1

  const months = useMemo(() => MONTHS.map((m, i) => ({ value: i + 1, label: m })), [])
  const days = useMemo(
    () => Array.from({ length: daysIn(month, year) }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [month, year],
  )
  const years = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => {
        const y = thisYear - 13 - i
        return { value: y, label: String(y) }
      }).reverse(),
    [],
  )

  return (
    <OnboardingScreen
      step={stepIndex('birth')}
      total={TOTAL_STEPS}
      title="When were you born?"
      subtitle="This will be taken into account when calculating your daily nutrition goals."
      onCta={() => {
        if (a.birthYear == null) {
          setAnswer('birthYear', year)
          setAnswer('birthMonth', month)
          setAnswer('birthDay', day)
        }
        router.push(nextRoute('birth') as never)
      }}
    >
      <View style={{ marginTop: 96 }}>
        <WheelHighlight>
          <Wheel
            label="Month"
            items={months}
            value={month}
            width={150}
            onChange={(v) => {
              setAnswer('birthMonth', v)
              // Clamp the day when the new month is shorter.
              const max = daysIn(v, year)
              if (day > max) setAnswer('birthDay', max)
            }}
          />
          <Wheel
            label="Day"
            items={days}
            value={day}
            width={70}
            onChange={(v) => setAnswer('birthDay', v)}
          />
          <Wheel
            label="Year"
            items={years}
            value={year}
            width={110}
            onChange={(v) => setAnswer('birthYear', v)}
          />
        </WheelHighlight>
      </View>
    </OnboardingScreen>
  )
}
