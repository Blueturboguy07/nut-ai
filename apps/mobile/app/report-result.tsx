import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../src/components/Icon'
import { openPublikLink } from '../src/inference/publik'
import { APP_NAME } from '../src/inference/publik-copy'
import { REPORT_REASONS, isSupportSource, supportUrl, type ReportReason } from '../src/support'
import { useTheme } from '../src/theme/ThemeProvider'
import { StatusBarScrim } from '../src/components/StatusBarScrim'
import { MIN_TAP_TARGET, radius, space, tap, type } from '../src/theme/tokens'

/**
 * Report a wrong result (App Store 1.2: a way to report bad AI content).
 *
 * Reached from every AI result: the scan result screen and the "Describe"
 * exercise estimate. The person picks a short reason; publik's in-app support
 * page opens in the in-app sheet with the app name, the version and that
 * reason. NO photo and NO meal data go with it: if the person wants to add a
 * photo or details, they add them on that page themselves.
 */
export default function ReportResult() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams()
  const source = isSupportSource(params.source) ? params.source : 'result'
  const [busy, setBusy] = useState(false)

  async function report(reason: ReportReason) {
    if (busy) return
    setBusy(true)
    await openPublikLink(supportUrl({ reason, source }))
    setBusy(false)
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }}
      >
        <View style={styles.head}>
          <Text style={[type.title, { color: theme.text, flex: 1 }]}>Report a wrong result</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
            <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
          </Pressable>
        </View>

        <Text style={[type.body, { color: theme.textMuted, marginTop: space.sm, lineHeight: 22 }]}>
          What is wrong with this AI result? Pick a reason. publik's support page for {APP_NAME} opens
          next.
        </Text>

        <View style={[styles.group, { backgroundColor: theme.bgSunken }]}>
          {REPORT_REASONS.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void report(r.id)}
              style={({ pressed }) => [styles.row, { borderBottomColor: theme.border, opacity: pressed || busy ? 0.6 : 1 }]}
            >
              <Text style={[type.body, { color: theme.text, flex: 1 }]}>{r.label}</Text>
              <Icon name="chevron" size={16} color={theme.textFaint} />
            </Pressable>
          ))}
        </View>

        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          The report sends the app name, the app version and the reason you pick. It sends no photo and
          no meal data. You can add a photo or details on the support page if you want to.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/how-estimates-work' as never)}
          style={[tap, { marginTop: space.lg, alignSelf: 'flex-start' }]}
        >
          <Text style={[type.label, { color: theme.protein }]}>How estimates work</Text>
        </Pressable>
      </ScrollView>
      <StatusBarScrim />
    </View>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  group: { marginTop: space.xl, borderRadius: radius.xl, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET + space.md,
  },
})
