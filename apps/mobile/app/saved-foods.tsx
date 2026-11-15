import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { db } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, tap, type } from '../src/theme/tokens'

/**
 * Saved meals.
 *
 * A saved meal stores the CORRECTED ingredient array, not a food name to
 * re-analyze. That is what makes relogging free: zero network requests, zero
 * clarifying questions, and identical numbers to the day you fixed them.
 */
interface SavedMeal {
  id: number
  name: string
  use_count: number
  items_json: string
}

export default function SavedFoods() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [meals, setMeals] = useState<SavedMeal[]>([])

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        const h = await db()
        const rows = await h.all<SavedMeal>(
          'SELECT id, name, use_count, items_json FROM saved_meals ORDER BY use_count DESC, last_used_at DESC',
        )
        if (alive) setMeals(rows)
      })()
      return () => { alive = false }
    }, []),
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Saved foods</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
          <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        {meals.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Nothing saved yet</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              After you correct a scan, save it. Relogging it later costs nothing — no scan, no
              network request, and none of the questions you already answered.
            </Text>
          </View>
        ) : (
          meals.map((m) => (
            <View key={m.id} style={[styles.row, { backgroundColor: theme.bgSunken }]}>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>{m.name}</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Logged {m.use_count} {m.use_count === 1 ? 'time' : 'times'}
                </Text>
              </View>
              <Text style={[type.label, { color: theme.protein }]}>Log again</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  empty: { padding: space.lg, borderRadius: radius.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg, marginBottom: space.sm,
  },
})
