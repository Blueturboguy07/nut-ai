import { router } from 'expo-router'
import Svg, { Circle } from 'react-native-svg'
import { StyleSheet, Text, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer } from '../../src/onboarding/store'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Rollover.
 *
 * This is a REAL setting with a real consumer: when on, up to 200 unused calories
 * carry into the next day's target. It is also the one screen in the flow with a
 * Yes/No pair instead of Continue.
 *
 * The cap matters and is not cosmetic. Uncapped rollover lets someone bank a week
 * of deficit into one day, which is the mechanic that turns a tracker into a
 * restrict-then-binge loop. 200 is enough to absorb a light day and not enough to
 * enable that.
 */
export const ROLLOVER_CAP_KCAL = 200

function MiniRing({ size = 96 }: { size?: number }) {
  const theme = useTheme()
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={theme.ringTrack} strokeWidth="7" fill="none"
      />
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={theme.text} strokeWidth="7" fill="none"
        strokeDasharray={`${c * 0.82} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  )
}

function DayCard({
  day, eaten, target, bonus, style,
}: {
  day: string
  eaten: number
  target: number
  bonus?: number
  style?: object
}) {
  const theme = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }, style]}>
      <View style={styles.cardHead}>
        <Icon name="flame" size={15} color={theme.text} />
        <Text style={[type.bodyStrong, { color: theme.text }]}>{day}</Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={[styles.big, { color: theme.text }]}>{eaten}</Text>
        <Text style={[type.body, { color: theme.textMuted }]}>/{target}</Text>
      </View>

      {bonus != null ? (
        <View style={[styles.bonus, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.protein, fontWeight: '700' }]}>+{bonus}</Text>
        </View>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <MiniRing />
      </View>
    </View>
  )
}

export default function RolloverScreen() {
  const theme = useTheme()

  const choose = (v: boolean) => {
    setAnswer('rolloverCalories', v)
    router.push(nextRoute('rollover') as never)
  }

  return (
    <OnboardingScreen
      step={stepIndex('rollover')}
      total={TOTAL_STEPS}
      title="Rollover extra calories to the next day?"
      cta="Yes"
      onCta={() => choose(true)}
      secondaryLabel="No"
      onSecondary={() => choose(false)}
      scroll
    >
      <Text style={[type.bodyStrong, { color: theme.text, marginTop: -space.md, marginBottom: space.xl }]}>
        Rollover up to <Text style={{ color: theme.protein }}>{ROLLOVER_CAP_KCAL} cals</Text>
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <DayCard day="Yesterday" eaten={2350} target={2500} />
        <DayCard day="Today" eaten={2350} target={2500} bonus={150} style={{ marginTop: space.xxl, marginLeft: -space.xl }} />
      </View>

      <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xl }]}>
        Capped at {ROLLOVER_CAP_KCAL} a day on purpose. Banking a whole week of unused calories
        into one day is the pattern that turns tracking into restrict-then-binge, so we don't
        allow it. You can change this any time in Settings.
      </Text>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  big: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  bonus: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: space.xs,
  },
})
