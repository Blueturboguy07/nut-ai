import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SupportSource } from '../support'
import { useTheme } from '../theme/ThemeProvider'
import { space, tap, type } from '../theme/tokens'

/**
 * Under every AI result (App Store 1.2): "Report a wrong result" (publik's
 * support page with a reason, no photo and no meal data: app/report-result.tsx)
 * and "How estimates work" (app/how-estimates-work.tsx).
 */
export function AiResultLinks({ source }: { source: SupportSource }) {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/report-result?source=${source}` as never)}
        style={tap}
      >
        <Text style={[type.label, { color: theme.protein }]}>Report a wrong result</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/how-estimates-work' as never)} style={tap}>
        <Text style={[type.label, { color: theme.textMuted }]}>How estimates work</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.md, marginTop: space.xl },
})
