import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EditableValue, RulerPicker } from '../src/components/onboarding/Controls'
import { logWeight, setting, weightHistory } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, tap, type } from '../src/theme/tokens'

const LB_PER_KG = 2.20462

/**
 * Log today's weight.
 *
 * A dated numeric point, nothing more. Deliberately NOT a slider you nudge from
 * yesterday's value — anchoring today's entry to yesterday's is how a weight log
 * quietly becomes fiction.
 *
 * This is also what feeds the adaptive-TDEE loop, which needs about five real
 * weigh-ins before it will touch anyone's target.
 */
export default function LogWeight() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const [kg, setKg] = useState(80)
  const [imperial, setImperial] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [history, units] = await Promise.all([weightHistory(), setting('units', 'imperial')])
      if (!alive) return
      const last = history[history.length - 1]
      if (last) setKg(last.weightKg)
      setImperial(units !== 'metric')
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  const shown = imperial ? kg * LB_PER_KG : kg
  const min = imperial ? 60 : 30
  const max = imperial ? 500 : 227

  async function save() {
    if (saving) return
    setSaving(true)
    await logWeight(kg, Date.now())
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Today's weight</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, paddingHorizontal: space.lg }]}>
        One number, dated today. Day-to-day scale weight is mostly water — the trend line on Trends
        is the thing worth watching, and it is what adjusts your calorie target.
      </Text>

      {ready ? (
        <>
          <View style={{ alignItems: 'center', marginTop: space.xxxl }}>
            <EditableValue
              value={shown}
              unit={imperial ? 'lbs' : 'kg'}
              min={min}
              max={max}
              onCommit={(v) => setKg(imperial ? v / LB_PER_KG : v)}
            />
          </View>

          <View style={{ marginTop: space.lg }}>
            <RulerPicker
              width={width}
              min={min}
              max={max}
              step={0.1}
              value={Number(shown.toFixed(1))}
              onChange={(v) => setKg(imperial ? v / LB_PER_KG : v)}
            />
          </View>
        </>
      ) : null}

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Pressable
          accessibilityRole="button"
          disabled={saving || !ready}
          onPress={save}
          style={[styles.cta, { backgroundColor: saving || !ready ? theme.border : theme.text }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Save</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginBottom: space.sm,
  },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: {
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
  },
})
