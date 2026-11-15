import { router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { APP_NAME } from '../src/inference/publik-copy'
import { useTheme } from '../src/theme/ThemeProvider'
import { StatusBarScrim } from '../src/components/StatusBarScrim'
import { space, tap, type } from '../src/theme/tokens'

/**
 * How estimates work (App Store 1.2 and 1.4.1): AI estimates can be wrong,
 * how the numbers are made, and that the app is not medical advice. Reached
 * from every AI result and from Profile → Help.
 */
const PARTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'AI estimates can be wrong',
    body: `${APP_NAME} uses an AI model to find the foods in a photo, to read a label or a receipt, to fix a result from what you type, and to estimate a workout that you describe. The AI can see the wrong food, miss an ingredient or guess the wrong amount. Always check the result before you log it.`,
  },
  {
    title: 'How the numbers are made',
    body: 'The AI says which foods it sees and about how much. The app then takes the nutrients from a food database, a printed label or a published web page, and adds them up. Each row shows a range for how certain its number is. A row from a web page names the site. A row that the AI estimated says "AI estimate".',
  },
  {
    title: 'You can correct every result',
    body: 'Before you log a result, you can change an amount, remove a food, or tap "Fix result" and say what is wrong. To tell us about a wrong result, tap "Report a wrong result".',
  },
  {
    title: 'Not medical advice',
    body: `${APP_NAME} is not a medical device. It does not diagnose, treat, cure or prevent any condition. Talk to a registered dietitian or a doctor before you make medical or diet decisions.`,
  },
]

export default function HowEstimatesWork() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }}
      >
        <View style={styles.head}>
          <Text style={[type.title, { color: theme.text, flex: 1 }]}>How estimates work</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
            <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
          </Pressable>
        </View>

        {PARTS.map((p) => (
          <View key={p.title} style={{ marginTop: space.xl }}>
            <Text style={[type.heading, { color: theme.text }]}>{p.title}</Text>
            <Text style={[type.body, { color: theme.textMuted, marginTop: space.sm, lineHeight: 23 }]}>{p.body}</Text>
          </View>
        ))}
      </ScrollView>
      <StatusBarScrim />
    </View>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
})
