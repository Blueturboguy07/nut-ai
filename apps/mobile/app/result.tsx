import { router } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { WebLookupResult } from '@nutai/core-schema'
import { healthScore } from '@nutai/totals'
import { ConfidenceChip, ConfidenceReasons } from '../src/components/ConfidenceChip'
import { Icon, type IconName } from '../src/components/Icon'
import { logMeal } from '../src/data/repo'
import { fixScan, lookupOther, retryScan } from '../src/scan/orchestrator'
import {
  answerQuestion,
  applyWebOption,
  editGrams,
  removeRow,
  reset,
  useScan,
  type WebLookupState,
} from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * The result screen.
 *
 * SPEC-accuracy-engine.md §8.2, and ruling 2 of PLAN.md §3.3.
 *
 * ONE primary action: `Log it`. There is no `Fix Results` mode.
 *
 * That is not a simplification, it is the fix. A separate "fix mode" structurally
 * forces the interruption cost to be paid even when nothing is worth asking, and
 * it is what makes "re-analysis that deletes the ingredients you already
 * corrected" possible at all. THE REVIEW SCREEN IS THE FIX SCREEN. Every row is
 * editable in place, and every edit recomputes locally, instantly, for free.
 */
export default function Result() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const phase = useScan()
  const [expandedBand, setExpandedBand] = useState(false)
  const [logging, setLogging] = useState(false)
  const [fixOpen, setFixOpen] = useState(false)
  const [fixText, setFixText] = useState('')

  if (phase.kind === 'analyzing' || phase.kind === 'captured') {
    const stage = phase.kind === 'analyzing' ? phase.stage : 'preparing'
    const copy =
      stage === 'preparing'
        ? 'Preparing the photo…'
        : stage === 'identifying'
          ? 'Identifying ingredients…'
          : 'Matching the nutrition database…'
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Image source={{ uri: phase.photoUri }} style={styles.photo} />
        <ActivityIndicator color={theme.textMuted} style={{ marginTop: space.xl }} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.md }]}>{copy}</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center' }]}>
          Your photo is saved — nothing is lost if this fails.
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Image source={{ uri: phase.photoUri }} style={[styles.photo, { opacity: 0.5 }]} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.xl, textAlign: 'center' }]}>
          Could not read this meal
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center', lineHeight: 19 }]}>
          {phase.message}
        </Text>
        {/* The one link a failure may carry (publik API's top_up_url). The URL
            was origin-checked when the failure was classified, never here. */}
        {phase.action ? (
          <Pressable
            onPress={() => void Linking.openURL(phase.action!.url)}
            style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl, paddingHorizontal: space.xl }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>{phase.action.label}</Text>
          </Pressable>
        ) : null}
        {phase.canRetry ? (
          <Pressable
            onPress={() => void retryScan()}
            style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl, paddingHorizontal: space.xl }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Try again</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => { reset(); router.back() }}
          hitSlop={space.md}
          style={{ marginTop: space.lg }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.heading, { color: theme.text }]}>Nothing to show yet</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  const { result } = phase
  const highlighted = result.questions.filter((q) => q.state === 'highlighted')
  const preAnswered = result.questions.filter((q) => q.state === 'pre_answered')

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 120 }}>
        <Text style={[type.title, { color: theme.text }]}>
          {result.items[0]?.row.displayName ?? 'Your meal'}
        </Text>

        {/* The point estimate leads. The band qualifies it — it never replaces it. */}
        <View style={{ marginTop: space.lg }}>
          <Text style={[type.hero, { color: theme.text }]}>{result.totals.kcal}</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: -space.xs }]}>kcal</Text>

          <View style={{ marginTop: space.md }}>
            <ConfidenceChip
              value={result.totals.kcal}
              band={result.mealBand}
              expanded={expandedBand}
              onPress={() => setExpandedBand((v) => !v)}
            />
            {expandedBand && <ConfidenceReasons band={result.mealBand} />}
          </View>
        </View>

        <StatsPager
          totals={result.totals}
          grams={result.meal.ingredients.reduce((a, r) => a + r.grams, 0)}
        />

        {/* Highlighted questions: at most two, ever. */}
        {highlighted.map((q) => (
          <View key={q.question.id} style={[styles.qCard, { borderColor: theme.uncertain, backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>{q.text}</Text>
            <View style={styles.chipRow}>
              {q.question.options.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => answerQuestion(q, opt.value)}
                  hitSlop={space.sm}
                  style={[styles.chip, { borderColor: theme.uncertain }]}
                >
                  <Text style={[type.label, { color: theme.text }]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {/* Every silent default is shown. None is ever hidden. */}
        {preAnswered.length > 0 && (
          <View style={{ marginTop: space.lg, gap: space.xs }}>
            {preAnswered.map((q) => (
              <Pressable key={q.question.id} onPress={() => answerQuestion(q, q.appliedDefault ?? '')} hitSlop={space.xs}>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  {q.disclosure} · <Text style={{ color: theme.uncertain }}>change</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Ingredients</Text>

        {result.meal.ingredients.map((row) => {
          const item = result.items.find((i) => i.row.id === row.id)
          const lookup = phase.webLookups[row.id]
          return (
            <View key={row.id}>
              <View style={[styles.row, { borderColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: theme.text }]}>{row.displayName}</Text>
                  {row.origin === 'web_lookup' && row.sourceUrl ? (
                    <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>
                      From {domainOf(row.sourceUrl)}
                    </Text>
                  ) : row.isEstimate ? (
                    <Text style={[type.micro, { color: theme.uncertain, marginTop: 2 }]}>AI ESTIMATE</Text>
                  ) : null}
                  {item && <ConfidenceChip value={(row.nutrientSnapshot.kcal * row.grams) / 100} band={item.band} />}
                </View>

                <TextInput
                  accessibilityLabel={`Grams of ${row.displayName}`}
                  keyboardType="numeric"
                  defaultValue={String(Math.round(row.grams))}
                  onChangeText={(t) => editGrams(row.id, Number(t))}
                  style={[styles.gramInput, { color: theme.text, borderColor: theme.border }]}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${row.displayName}`}
                  onPress={() => removeRow(row.id)}
                  hitSlop={space.md}
                  style={styles.remove}
                >
                  <Text style={{ color: theme.textFaint, fontSize: 20 }}>×</Text>
                </Pressable>
              </View>

              {lookup ? <WebLookupCard rowId={row.id} state={lookup} /> : null}
            </View>
          )
        })}
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg, borderColor: theme.border }]}>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFixOpen(true)}
            style={[styles.secondary, { borderColor: theme.border }]}
          >
            <Icon name="pencil" size={16} color={theme.text} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Fix result</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={logging}
            onPress={() => {
              if (logging) return
              setLogging(true)
              void (async () => {
                try {
                  await logMeal(result, phase.meta, phase.photoUri, Date.now())
                  reset()
                  router.dismissAll()
                } catch {
                  setLogging(false)
                }
              })()
            }}
            style={[styles.primary, { flex: 1, backgroundColor: theme.text }, logging && { opacity: 0.6 }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>{logging ? 'Logging…' : 'Log it'}</Text>
          </Pressable>
        </View>
      </View>

      {fixOpen ? (
        <View style={[styles.fixOverlay, { backgroundColor: theme.bg, paddingTop: insets.top + space.xl }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="pencil" size={20} color={theme.text} />
            <Text style={[type.title, { color: theme.text }]}>Fix result</Text>
          </View>
          <TextInput
            autoFocus
            multiline
            placeholder="Describe what needs to be fixed"
            placeholderTextColor={theme.textFaint}
            value={fixText}
            onChangeText={setFixText}
            style={[styles.fixInput, { color: theme.text, borderColor: theme.border }]}
          />
          <View style={[styles.fixExample, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
              <Text style={{ fontWeight: '600' }}>Example:</Text> The wrap is missing the chicken and
              avocado. Only what you mention gets changed — your other edits stay put.
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            disabled={!fixText.trim()}
            onPress={() => {
              const note = fixText.trim()
              setFixOpen(false)
              setFixText('')
              if (note) void fixScan(note)
            }}
            style={[
              styles.primary,
              { backgroundColor: theme.text, marginBottom: Math.max(insets.bottom, space.lg) },
              !fixText.trim() && { opacity: 0.4 },
            ]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Update</Text>
          </Pressable>
          <Pressable
            onPress={() => setFixOpen(false)}
            hitSlop={space.md}
            style={{ alignSelf: 'center', marginBottom: Math.max(insets.bottom, space.lg) }}
          >
            <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function domainOf(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)
  return m?.[1] ?? url
}

/**
 * The web-lookup card under a row the corpus missed.
 *
 * Three states: a quiet "checking" line, a generated multiple-choice question
 * where EVERY option already carries its published nutrition (tapping is a
 * free local swap), and an Other row that runs one more search with whatever
 * the user typed.
 */
function WebLookupCard({ rowId, state }: { rowId: string; state: WebLookupState }) {
  const theme = useTheme()
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')

  if (state.status === 'running') {
    return (
      <View style={[styles.lookupQuiet, { backgroundColor: theme.bgSunken }]}>
        <ActivityIndicator size="small" color={theme.textFaint} />
        <Text style={[type.caption, { color: theme.textMuted }]}>
          Checking the web for published nutrition…
        </Text>
      </View>
    )
  }
  if (state.status === 'failed') return null

  const result: WebLookupResult = state.result
  // A single auto-applied option needs no card — the row above already shows
  // its source.
  if (result.options.length <= 1 && !result.question) return null

  return (
    <View style={[styles.qCard, { borderColor: theme.uncertain, backgroundColor: theme.uncertainBg, marginTop: space.sm }]}>
      <Text style={[type.bodyStrong, { color: theme.text }]}>
        {result.question ?? 'Which one was it?'}
      </Text>
      {result.source_url ? (
        <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>
          Menu data from {domainOf(result.source_url)}
        </Text>
      ) : null}

      <View style={{ marginTop: space.md, gap: space.sm }}>
        {result.options.map((opt) => (
          <Pressable
            key={opt.label}
            onPress={() => applyWebOption(rowId, opt, result.source_url)}
            style={[styles.optionRow, { borderColor: theme.uncertain, backgroundColor: theme.bg }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: theme.text }]}>{opt.label}</Text>
              {opt.serving_desc ? (
                <Text style={[type.micro, { color: theme.textMuted, marginTop: 1 }]}>{opt.serving_desc}</Text>
              ) : null}
            </View>
            <Text style={[type.label, { color: theme.textMuted }]}>{Math.round(opt.calories_kcal)} kcal</Text>
          </Pressable>
        ))}

        {otherOpen ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput
              autoFocus
              placeholder="Type what it was"
              placeholderTextColor={theme.textFaint}
              value={otherText}
              onChangeText={setOtherText}
              onSubmitEditing={() => {
                if (otherText.trim()) void lookupOther(rowId, otherText.trim())
                setOtherOpen(false)
              }}
              returnKeyType="search"
              style={[styles.otherInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
            />
            <Pressable
              onPress={() => {
                if (otherText.trim()) void lookupOther(rowId, otherText.trim())
                setOtherOpen(false)
              }}
              hitSlop={space.sm}
            >
              <Icon name="search" size={18} color={theme.text} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setOtherOpen(true)} style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.bg }]}>
            <Text style={[type.body, { color: theme.textMuted }]}>Other…</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

function Macro({
  label,
  value,
  unit = 'g',
  color,
  icon,
}: {
  label: string
  value: number
  unit?: string
  color: string
  icon: IconName
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={[type.heading, { color: theme.text }]}>{Math.round(value)}</Text>
        <Text style={[type.caption, { color: theme.textFaint }]}>{unit}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 }}>
        <Icon name={icon} size={14} color={color} />
        <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      </View>
    </View>
  )
}

/**
 * Two stat pages, swipeable like the incumbent's: macros, then
 * fiber/sugar/sodium with the health score. The score is arithmetic from
 * @nutai/totals — tap it and every point shows its named rule.
 */
function StatsPager({ totals, grams }: { totals: Parameters<typeof healthScore>[0]; grams: number }) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const pageW = width - space.lg * 2
  const [page, setPage] = useState(0)
  const [showWhy, setShowWhy] = useState(false)
  const hs = healthScore(totals, grams > 0 ? grams : undefined)

  return (
    <View style={{ marginTop: space.xl }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageW))}
      >
        <View style={[styles.statsPage, { width: pageW }]}>
          <Macro label="Protein" value={totals.protein_g} color={theme.protein} icon="protein" />
          <Macro label="Carbs" value={totals.carbs_g} color={theme.carbs} icon="carbs" />
          <Macro label="Fat" value={totals.fat_g} color={theme.fat} icon="fat" />
        </View>

        <View style={{ width: pageW }}>
          <View style={styles.statsPage}>
            <Macro label="Fiber" value={totals.fiber_g} color={theme.carbs} icon="fiber" />
            <Macro label="Sugar" value={totals.sugar_g} color={theme.uncertain} icon="sugar" />
            <Macro label="Sodium" value={totals.sodium_mg} unit="mg" color={theme.fat} icon="sodium" />
          </View>

          {hs ? (
            <Pressable
              onPress={() => setShowWhy((v) => !v)}
              style={[styles.healthCard, { backgroundColor: theme.bgSunken }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Icon name="heart" size={18} color={theme.protein} />
                <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>Health score</Text>
                <Text style={[type.bodyStrong, { color: theme.text }]}>{hs.score}/10</Text>
              </View>
              <View style={[styles.healthTrack, { backgroundColor: theme.bgElevated }]}>
                <View
                  style={[
                    styles.healthFill,
                    { width: `${hs.score * 10}%` as const, backgroundColor: theme.affirm },
                  ]}
                />
              </View>
              {showWhy &&
                hs.reasons.map((r) => (
                  <Text key={r} style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
                    · {r}
                  </Text>
                ))}
              {showWhy && (
                <Text style={[type.micro, { color: theme.textFaint, marginTop: space.sm }]}>
                  Computed by fixed rules from these totals — never by the AI.
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.dots}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i === page ? theme.text : theme.border }]}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  statsPage: { flexDirection: 'row', gap: space.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.md },
  dot: { width: 6, height: 6, borderRadius: 3 },
  healthCard: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  healthTrack: { height: 6, borderRadius: 3, marginTop: space.md, overflow: 'hidden' },
  healthFill: { height: 6, borderRadius: 3 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  fixOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: space.lg },
  fixInput: {
    marginTop: space.xl,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 88,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  fixExample: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  qCard: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gramInput: {
    width: 64,
    textAlign: 'right',
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET,
  },
  photo: { width: 160, height: 160, borderRadius: radius.lg },
  lookupQuiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    marginTop: space.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  otherInput: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET,
  },
  remove: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
