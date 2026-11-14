import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { PUBLIK_GATE_MODE } from '../../src/build-flags'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Welcome.
 *
 * Two deliberate departures from the reference:
 *
 *   NO "Already have an account? Sign In". The only account is the publik
 *   account, and Sign in with publik is its own screen: before onboarding in
 *   a required build, and at the AI plan choice or in Profile in an optional
 *   build. The food log has no account; it stays on this phone.
 *
 *   NO language pill. English is the only shipped locale; a picker with one
 *   option is a control that lies about what it does.
 */
export default function Welcome() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.hero}>
        <View style={[styles.phone, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
          <Text style={[type.micro, { color: theme.textMuted }]}>Today</Text>
          <View style={{ alignItems: 'center', marginTop: space.md }}>
            <Svg width={104} height={104}>
              <Circle cx={52} cy={52} r={44} stroke={theme.ringTrack} strokeWidth="9" fill="none" />
              <Circle
                cx={52} cy={52} r={44}
                stroke={theme.text} strokeWidth="9" fill="none"
                strokeDasharray={`${2 * Math.PI * 44 * 0.68} ${2 * Math.PI * 44}`}
                strokeLinecap="round"
                transform="rotate(-90 52 52)"
              />
            </Svg>
            <Text style={[styles.heroNum, { color: theme.text }]}>2,340</Text>
            <Text style={[type.caption, { color: theme.textMuted }]}>Calories left</Text>
          </View>

          <View style={styles.macroRow}>
            {[
              { v: '161g', l: 'Protein', c: theme.protein },
              { v: '204g', l: 'Carbs', c: theme.carbs },
              { v: '61g', l: 'Fat', c: theme.fat },
            ].map((m) => (
              <View key={m.l} style={{ alignItems: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.c }} />
                <Text style={[type.label, { color: theme.text, marginTop: 4 }]}>{m.v}</Text>
                <Text style={[type.micro, { color: theme.textMuted }]}>{m.l}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.xl) }]}>
        <Text style={[styles.title, { color: theme.text }]}>Calorie tracking{'\n'}made easy</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/onboarding/sex' as never)}
          style={[styles.cta, { backgroundColor: theme.text }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Get Started</Text>
        </Pressable>

        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.lg }]}>
          {PUBLIK_GATE_MODE === 'optional' ? 'No account needed. ' : ''}Meal photos go to the AI provider you
          choose. Your food log stays on this phone.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/onboarding/restore' as never)}
          hitSlop={space.sm}
          style={{ marginTop: space.md, alignSelf: 'center' }}
        >
          <Text style={[type.label, { color: theme.textMuted, textDecorationLine: 'underline' }]}>
            Restore from a backup
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  phone: {
    width: 240,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    transform: [{ rotate: '6deg' }],
  },
  heroNum: { fontSize: 30, fontWeight: '800', letterSpacing: -1, marginTop: space.sm },
  macroRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: space.lg },
  bottom: { paddingHorizontal: space.lg },
  title: {
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: -1.4,
    textAlign: 'center',
    marginBottom: space.xl,
  },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
