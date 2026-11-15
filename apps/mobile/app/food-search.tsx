import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DbAdapter } from '@nutai/db-adapter'
import { KEYBOARD_DONE_ID, KeyboardDoneBar } from '../src/components/KeyboardDone'
import { StatusBarScrim } from '../src/components/StatusBarScrim'
import { useKeyboardInset } from '../src/components/useKeyboardInset'
import { nutritionCorpusInfo, openNutritionDb } from '../src/db/expo-adapter'
import { amountTotals, foodFacts, parseGrams, type FoodFacts } from '../src/data/food-amount'
import { searchFoods, type FoodHit } from '../src/data/food-search'
import { logManualFood } from '../src/data/manual-food'
import { db } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, tap, type } from '../src/theme/tokens'

/** grams to one decimal, as text for the field ("118", "50", "13.5"). */
const gramsText = (g: number) => String(Math.round(g * 10) / 10)

/**
 * Food Database: search the bundled USDA foods, pick one, choose the amount,
 * log it. Everything here is local; this screen makes no network request.
 *
 * Blind test round 2 (Nov 15 2026, N4): one tap logged a fixed amount. Now a
 * tap opens the amount step: the food's servings (a realistic default
 * serving is selected, food-amount.ts), a number of servings, a grams field,
 * and the live kcal and macros. "Log it" saves exactly the numbers on screen.
 */
export default function FoodSearch() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardInset()

  const [nutritionDb, setNutritionDb] = useState<DbAdapter | null>(null)
  const [corpus, setCorpus] = useState<{ foods: number; portions: number; builtAt: string | null } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodHit[]>([])
  const [outcome, setOutcome] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The amount step.
  const [facts, setFacts] = useState<FoodFacts | null>(null)
  const [opening, setOpening] = useState<number | null>(null)
  const [servingIndex, setServingIndex] = useState<number | null>(null)
  const [count, setCount] = useState(1)
  const [gramsField, setGramsField] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // A database that cannot be opened says so, instead of "Loading…" forever.
      try {
        const handle = await openNutritionDb()
        const info = await nutritionCorpusInfo(handle)
        if (!alive) return
        setNutritionDb(handle)
        setCorpus(info)
      } catch {
        if (alive) setCorpus({ foods: 0, portions: 0, builtAt: null })
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!nutritionDb || query.trim().length < 2) { setResults([]); setOutcome(''); setBusy(false); return }
    let alive = true
    setBusy(true)
    const timer = setTimeout(async () => {
      const r = await searchFoods(nutritionDb, query).catch(() => ({ results: [] as FoodHit[], outcome: 'none' as const }))
      if (!alive) return
      setResults(r.results)
      setOutcome(
        r.outcome === 'best' ? '1 match' : r.outcome === 'many' ? `${r.results.length} matches. Tap a food.` : 'No match',
      )
      setBusy(false)
    }, 180)
    return () => { alive = false; clearTimeout(timer) }
  }, [nutritionDb, query])

  async function openFood(hit: FoodHit) {
    if (!nutritionDb || opening != null) return
    setOpening(hit.foodId)
    setError(null)
    try {
      const f = await foodFacts(nutritionDb, hit.foodId)
      if (!f) throw new Error('missing')
      setFacts(f)
      setServingIndex(f.defaultIndex)
      setCount(1)
      setGramsField(gramsText(f.servings[f.defaultIndex]!.grams))
    } catch {
      setError('Could not open that food. Try again.')
    } finally {
      setOpening(null)
    }
  }

  function pickServing(i: number) {
    if (!facts) return
    setServingIndex(i)
    setGramsField(gramsText(facts.servings[i]!.grams * count))
  }

  function changeCount(delta: number) {
    if (!facts) return
    const next = Math.min(20, Math.max(0.5, Math.round((count + delta) * 2) / 2))
    setCount(next)
    if (servingIndex != null) setGramsField(gramsText(facts.servings[servingIndex]!.grams * next))
  }

  function typeGrams(text: string) {
    setGramsField(text)
    // A typed amount is no longer "N servings".
    setServingIndex(null)
    setCount(1)
  }

  const grams = parseGrams(gramsField)
  const totals = facts && grams != null ? amountTotals(facts.per100, grams) : null

  async function logIt() {
    if (!facts || grams == null || saving) return
    setSaving(true)
    setError(null)
    try {
      await logManualFood(
        await db(),
        { foodId: facts.foodId, displayName: facts.name, grams, nutrientSnapshot: facts.per100 },
        Date.now(),
      )
      router.back()
    } catch {
      setError('Could not log that food. Try again.')
      setSaving(false)
    }
  }

  const corpusLine = useMemo(() => {
    if (!corpus) return 'Loading the food database…'
    if (corpus.foods === 0) {
      return 'The food database did not load. Close the app and open it again.'
    }
    return `${corpus.foods.toLocaleString()} foods · ${corpus.portions.toLocaleString()} portion weights · USDA, CC0`
  }, [corpus])

  if (facts) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 160 + keyboard }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable accessibilityRole="button" onPress={() => setFacts(null)} style={tap}>
              <Text style={[type.body, { color: theme.textMuted }]}>Back</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
              <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
            </Pressable>
          </View>

          <Text style={[type.heading, { color: theme.text, marginTop: space.sm }]}>{facts.name}</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
            {Math.round(facts.per100.kcal)} kcal in 100 g
          </Text>

          <Text style={[type.micro, { color: theme.textFaint, marginTop: space.xl }]}>AMOUNT</Text>
          <View style={styles.chips}>
            {facts.servings.map((s, i) => {
              const on = servingIndex === i
              return (
                <Pressable
                  key={`${s.label}-${i}`}
                  testID={`food-amount-serving-${i}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => pickServing(i)}
                  style={[
                    styles.chip,
                    { borderColor: on ? theme.text : theme.border, backgroundColor: on ? theme.bgSunken : 'transparent' },
                  ]}
                >
                  <Text style={[type.caption, { color: theme.text }]} numberOfLines={2}>
                    {s.label} · {gramsText(s.grams)} g
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {servingIndex != null && (
            <View style={styles.countRow}>
              <Text style={[type.body, { color: theme.text, flex: 1 }]}>Servings</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fewer servings"
                onPress={() => changeCount(-0.5)}
                style={[styles.stepper, { borderColor: theme.border }]}
              >
                <Text style={[type.bodyStrong, { color: theme.text }]}>−</Text>
              </Pressable>
              <Text style={[type.bodyStrong, { color: theme.text, minWidth: 40, textAlign: 'center' }]}>{count}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More servings"
                onPress={() => changeCount(0.5)}
                style={[styles.stepper, { borderColor: theme.border }]}
              >
                <Text style={[type.bodyStrong, { color: theme.text }]}>+</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.countRow}>
            <Text style={[type.body, { color: theme.text, flex: 1 }]}>Grams</Text>
            <TextInput
              testID="food-amount-grams"
              accessibilityLabel="Amount in grams"
              value={gramsField}
              onChangeText={typeGrams}
              keyboardType="decimal-pad"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
              style={[styles.grams, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
            />
            <Text style={[type.body, { color: theme.textMuted }]}>g</Text>
          </View>
          {grams == null && (
            <Text style={[type.caption, { color: theme.safety, marginTop: space.sm }]}>
              Type an amount from 1 to 5000 g.
            </Text>
          )}

          {totals && (
            <View style={[styles.totals, { backgroundColor: theme.bgSunken }]}>
              <Text testID="food-amount-kcal" style={[type.hero, { color: theme.text }]}>{totals.kcal}</Text>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: -space.xs }]}>kcal</Text>
              <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.md }}>
                <Text style={[type.caption, { color: theme.text }]}>Protein {totals.protein_g} g</Text>
                <Text style={[type.caption, { color: theme.text }]}>Carbs {totals.carbs_g} g</Text>
                <Text style={[type.caption, { color: theme.text }]}>Fat {totals.fat_g} g</Text>
              </View>
            </View>
          )}

          {error != null && (
            <Text style={[type.caption, { color: theme.safety, marginTop: space.md }]}>{error}</Text>
          )}
        </ScrollView>
        <StatusBarScrim />
        <KeyboardDoneBar />

        <View
          style={[
            styles.dock,
            {
              bottom: keyboard,
              paddingBottom: keyboard > 0 ? space.md : Math.max(insets.bottom, space.lg),
              backgroundColor: theme.bg,
              borderColor: theme.border,
            },
          ]}
        >
          <Pressable
            testID="food-amount-log"
            accessibilityRole="button"
            disabled={totals == null || saving}
            onPress={() => void logIt()}
            style={[styles.primary, { backgroundColor: theme.text }, (totals == null || saving) && { opacity: 0.5 }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>
              {totals ? `Log ${gramsText(grams ?? 0)} g · ${totals.kcal} kcal` : 'Log it'}
            </Text>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 160 + keyboard }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.title, { color: theme.text }]}>Food Database</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
          <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: corpus?.foods === 0 ? theme.safety : theme.textMuted, marginTop: space.xs }]}>
        {corpusLine}
      </Text>

      <TextInput
        accessibilityLabel="Search foods"
        placeholder="Search, for example “banana”"
        placeholderTextColor={theme.textFaint}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
      />

      {busy && <ActivityIndicator style={{ marginTop: space.lg }} color={theme.textFaint} />}

      {outcome !== '' && (
        <Text style={[type.micro, { color: theme.textFaint, marginTop: space.md }]}>{outcome.toUpperCase()}</Text>
      )}

      {error != null && (
        <Text style={[type.caption, { color: theme.safety, marginTop: space.md }]}>{error}</Text>
      )}

      {results.map((r) => (
        <Pressable
          key={r.foodId}
          testID={`food-search-row-${r.foodId}`}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${r.name}`}
          disabled={opening != null}
          onPress={() => void openFood(r)}
          style={({ pressed }) => [
            styles.row,
            { borderColor: theme.border, minHeight: MIN_TAP_TARGET, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: theme.text }]} numberOfLines={2}>{r.name}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
              {r.energyKcal != null ? `${Math.round(r.energyKcal)} kcal in 100 g` : 'No energy value'}
            </Text>
          </View>
          {opening === r.foodId ? <ActivityIndicator color={theme.textFaint} /> : null}
        </Pressable>
      ))}

      {query.trim().length >= 2 && !busy && results.length === 0 && (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.lg }]}>
          No food in the database matches. Try a shorter or more general name, for example
          “rice” instead of “jasmine rice bowl”.
        </Text>
      )}
    </ScrollView>
    <StatusBarScrim />
    </View>
  )
}

const styles = StyleSheet.create({
  input: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  stepper: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grams: {
    width: 110,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: MIN_TAP_TARGET,
    textAlign: 'right',
  },
  totals: { marginTop: space.xl, padding: space.lg, borderRadius: radius.lg },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
})
