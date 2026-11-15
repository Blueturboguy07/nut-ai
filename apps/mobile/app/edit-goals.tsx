import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { reconcileFromMacros } from '@nutai/totals'
import { KEYBOARD_DONE_ID, KeyboardDoneBar } from '../src/components/KeyboardDone'
import { currentGoal, overrideTargets, type CurrentGoal } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, tap, type } from '../src/theme/tokens'

/**
 * Edit nutrition goals.
 *
 * Two rules carried over from the engine, because a settings screen that breaks
 * them re-introduces the exact bug the engine was built to prevent:
 *
 *   CARBS ARE THE DERIVED VARIABLE. Editing calories, protein or fat re-solves
 *   carbs as the remainder. There is always exactly one dependent value, so the
 *   four numbers can never drift out of agreement.
 *
 *   SAVING TURNS THE ADAPTIVE LOOP OFF. Silently overwriting a target someone
 *   deliberately typed is the fastest way to lose their trust in every other
 *   number in the app.
 */
export default function EditGoals() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [base, setBase] = useState<CurrentGoal | null>(null)
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [fat, setFat] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void currentGoal().then((g) => {
      if (!alive || !g) return
      setBase(g)
      setKcal(String(Math.round(g.targetKcal)))
      setProtein(String(Math.round(g.protein_g)))
      setFat(String(Math.round(g.fat_g)))
    })
    return () => {
      alive = false
    }
  }, [])

  const n = (s: string) => {
    const v = Number.parseFloat(s)
    return Number.isFinite(v) && v >= 0 ? v : 0
  }

  const kcalV = n(kcal)
  const proteinV = n(protein)
  const fatV = n(fat)
  // The single derived value.
  const carbsV = Math.max(0, (kcalV - 4 * proteinV - 9 * fatV) / 4)
  const impossible = kcalV > 0 && 4 * proteinV + 9 * fatV > kcalV

  async function save() {
    if (!base || saving || kcalV <= 0 || impossible) return
    setSaving(true)
    await overrideTargets(
      {
        targetKcal: kcalV,
        macros: { protein_g: proteinV, fat_g: fatV, carbs_g: carbsV, carbsFloored: carbsV === 0 },
      },
      base,
      Date.now(),
    )
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Nutrition goals</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        <Field label="Calories" unit="kcal" value={kcal} onChange={setKcal} />
        <Field label="Protein" unit="g" value={protein} onChange={setProtein} />
        <Field label="Fat" unit="g" value={fat} onChange={setFat} />

        <View style={[styles.derived, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={[type.body, { color: theme.textMuted }]}>Carbs</Text>
            <Text style={[styles.big, { color: theme.text }]}>{Math.round(carbsV)} g</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 18 }]}>
            Carbs are always the remainder, so your four numbers can never disagree with each other.
            Change calories, protein or fat and this re-solves.
          </Text>
        </View>

        {impossible ? (
          <View style={[styles.warn, { backgroundColor: theme.safetyBg }]}>
            <Text style={[type.caption, { color: theme.safety }]}>
              Protein and fat alone already exceed {Math.round(kcalV)} kcal
              ({Math.round(reconcileFromMacros(proteinV, 0, fatV))} kcal). Raise calories or lower one
              of them.
            </Text>
          </View>
        ) : null}

        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text, lineHeight: 18 }]}>
            Saving switches OFF the adaptive target. We will not quietly overwrite a number you
            chose on purpose — you can turn adaptation back on by regenerating your plan.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={save}
          disabled={kcalV <= 0 || impossible || saving}
          style={[styles.cta, { backgroundColor: kcalV > 0 && !impossible ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Save</Text>
        </Pressable>
      </View>
      <KeyboardDoneBar />
    </View>
  )
}

function Field({
  label, unit, value, onChange,
}: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: space.xs }]}>{label}</Text>
      <View style={[styles.field, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
        <TextInput
          keyboardType="number-pad"
          inputAccessoryViewID={KEYBOARD_DONE_ID}
          value={value}
          onChangeText={onChange}
          accessibilityLabel={`${label} in ${unit}`}
          style={[styles.input, { color: theme.text }]}
        />
        <Text style={[type.body, { color: theme.textMuted }]}>{unit}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, minHeight: 56,
  },
  input: { flex: 1, fontSize: 22, fontWeight: '700', paddingVertical: space.md },
  derived: { padding: space.lg, borderRadius: radius.lg },
  big: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  note: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
