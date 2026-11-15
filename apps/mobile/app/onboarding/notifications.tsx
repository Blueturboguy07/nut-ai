import { Redirect, router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { FLOW, nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { Icon } from '../../src/components/Icon'
import { APP_NAME } from '../../src/inference/publik-copy'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Reminders.
 *
 * The system permission prompt is deliberately NOT requested here. Local
 * reminders are an M5 feature, and asking for a permission the app cannot yet
 * use is how apps train people to hit "Don't Allow" — you get one prompt, and
 * spending it before there is anything to deliver wastes it.
 *
 * Whether reminders default ON is already decided by the blocker answer
 * (featureDefaultsFor), so this screen is explanation, not another question.
 */
export default function NotificationsScreen() {
  const theme = useTheme()
  // Reminders are not built yet: the flow leaves this step out (flow.ts NOT_BUILT).
  if (!FLOW.includes('notifications')) return <Redirect href={nextRoute('notifications') as never} />
  return (
    <OnboardingScreen
      step={stepIndex('notifications')}
      total={TOTAL_STEPS}
      title={`Stay on track with ${APP_NAME}`}
      onCta={() => router.push(nextRoute('notifications') as never)}
      scroll
    >
      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Icon name="clock" size={44} color={theme.text} weight={1.5} />
        <Text style={[type.bodyStrong, { color: theme.text, marginTop: space.md }]}>
          A nudge when you'd usually log
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm }]}>
          Reminders learn from when you actually log rather than firing at a fixed hour, and every
          one is local to your device. Nothing is scheduled on a server.
        </Text>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, marginTop: space.lg }]}>
        We'll ask for notification permission the first time a reminder is actually worth sending,
        not now. You can turn them on or off any time in Settings.
      </Text>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.xl, borderRadius: radius.xl, alignItems: 'center' },
})
