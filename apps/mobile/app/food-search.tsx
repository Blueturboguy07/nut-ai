import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DbAdapter } from '@nutai/db-adapter'
import { resolveByText, type ScoredCandidate } from '@nutai/resolver'
import { nutritionCorpusInfo, openNutritionDb } from '../src/db/expo-adapter'
import { db } from '../src/data/repo'
import { resolveSelection } from '../src/data/food-search-select'
import { logManualFood } from '../src/data/manual-food'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * What a tap on a candidate row does, end to end: resolve its grams + snapshot
 * from the (read-only) nutrition corpus (`resolveSelection`), then log it to
 * today in the user db (`logManualFood`). Both of those are pure, DB-only
 * functions with their own regression coverage in food-search-select.test.ts;
 * this function additionally reaches for the live app db singleton via
 * `db()`, so — like every other screen in this app — it is only exercised by
 * the running app, not by that test.
 */
async function selectFood(nutritionDb: DbAdapter, candidate: ScoredCandidate, now: number): Promise<number> {
  const selection = await resolveSelection(nutritionDb, candidate)
  const userDb = await db()
  return logManualFood(userDb, selection, now)
}

/**
 * Foods — the food library (there is no social feed).
 *
 * Right now it is also the honest way to test the whole resolution stack on
 * device WITHOUT an API key: type a food, and the query runs through the real
 * `@nutai/resolver` — FTS5 candidate generation, six-signal scoring, the two-part
 * auto-accept rule — against the real 7,928-row USDA corpus. Everything here is
 * local. No network request is made by this screen, ever.
 */
export default function FoodSearch() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [db, setDb] = useState<DbAdapter | null>(null)
  const [corpus, setCorpus] = useState<{ foods: number; portions: number; builtAt: string | null } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScoredCandidate[]>([])
  const [outcome, setOutcome] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const handle = await openNutritionDb()
      const info = await nutritionCorpusInfo(handle)
      if (!alive) return
      setDb(handle)
      setCorpus(info)
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!db || query.trim().length < 2) { setResults([]); setOutcome(''); return }
    let alive = true
    setBusy(true)
    const timer = setTimeout(async () => {
      const r = await resolveByText(db, {
        canonicalFoodKey: query,
        observedBrand: null,
        prepFacet: null,
        modelCategory: null,
        estimatedGrams: 150,
      })
      if (!alive) return
      if (r.outcome.kind === 'auto_accept') {
        setResults([r.outcome.match])
        setOutcome('Best match')
      } else if (r.outcome.kind === 'disambiguate') {
        setResults(r.outcome.candidates)
        setOutcome(`${r.outcome.candidates.length} matches — tap the right one`)
      } else {
        setResults([])
        setOutcome('No match')
      }
      setBusy(false)
    }, 180)
    return () => { alive = false; clearTimeout(timer) }
  }, [db, query])

  async function handleSelect(candidate: ScoredCandidate) {
    if (!db || selectingId != null) return
    setSelectingId(candidate.foodId)
    setError(null)
    try {
      await selectFood(db, candidate, Date.now())
      router.back()
    } catch {
      setError('Could not log that food — try again.')
      setSelectingId(null)
    }
  }

  const corpusLine = useMemo(() => {
    if (!corpus) return 'Loading the food database…'
    if (corpus.foods === 0) {
      return 'The food database did not load. Close the app and open it again.'
    }
    return `${corpus.foods.toLocaleString()} foods · ${corpus.portions.toLocaleString()} portion weights · USDA, CC0`
  }, [corpus])

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 160 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.title, { color: theme.text }]}>Food Database</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: corpus?.foods === 0 ? theme.safety : theme.textMuted, marginTop: space.xs }]}>
        {corpusLine}
      </Text>

      <TextInput
        accessibilityLabel="Search foods"
        placeholder="Search — try “chicken breast”"
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
          accessibilityLabel={`Log ${r.name}`}
          disabled={selectingId != null}
          onPress={() => handleSelect(r)}
          style={({ pressed }) => [
            styles.row,
            { borderColor: theme.border, minHeight: MIN_TAP_TARGET, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: theme.text }]} numberOfLines={2}>{r.name}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
              {r.energyKcal != null ? `${Math.round(r.energyKcal)} kcal / 100 g` : 'energy not reported'}
              {r.brand ? ` · ${r.brand}` : ''}
            </Text>
          </View>
          {selectingId === r.foodId ? <ActivityIndicator color={theme.textFaint} /> : null}
        </Pressable>
      ))}

      {query.trim().length >= 2 && !busy && results.length === 0 && (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.lg }]}>
          No food in the database matches. Try a shorter or more general name, for example
          “rice” instead of “jasmine rice bowl”.
        </Text>
      )}
    </ScrollView>
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
})
