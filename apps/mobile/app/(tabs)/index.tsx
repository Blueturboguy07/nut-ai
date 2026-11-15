import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { Icon, type IconName } from '../../src/components/Icon'
import {
  currentGoal,
  dayTotals,
  deleteExercise,
  exerciseOn,
  localDate,
  runAdaptive,
  type AdaptiveOutcome,
  type CurrentGoal,
  type DayTotals,
  type ExerciseEntry,
} from '../../src/data/repo'
import { useTheme } from '../../src/theme/ThemeProvider'
import { StatusBarScrim } from '../../src/components/StatusBarScrim'
import { APP_NAME } from '../../src/inference/publik-copy'
import { radius, space, tap, tapIcon, type } from '../../src/theme/tokens'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Home.
 *
 * Three rules this screen will not break, all of them about not moralising:
 *
 *   A day with nothing logged reads "no entries logged" in a neutral colour.
 *   Never "missed", never red — red is reserved for safety warnings.
 *
 *   Over target is STATED, not scolded. The ring draws a second overflow arc
 *   rather than clamping at 100% and lying about it.
 *
 *   Pending scans contribute ZERO calories and show as a count. A number that
 *   silently grows later is worse than one that is visibly incomplete.
 *
 * Every number on Home comes from the food log (App Store 2.1, Nov 14 2026):
 * the fixed streak pill, the fixed fiber/sugar/sodium cards, the "N/A" health
 * score, the steps card and the water card (its button did nothing) were
 * removed. The real streak is on Progress; the real health score is on each
 * scan result.
 */
export default function Home() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [totals, setTotals] = useState<DayTotals | null>(null)
  const [adaptive, setAdaptive] = useState<AdaptiveOutcome | null>(null)
  const [workouts, setWorkouts] = useState<ExerciseEntry[]>([])
  const [round, setRound] = useState(0)
  const [offset, setOffset] = useState(0)

  const selected = useMemo(() => Date.now() + offset * 86_400_000, [offset])

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        // The adaptive loop runs BEFORE reading the goal, so a target it just
        // changed is the one rendered. Its own gates decide whether it may act.
        const outcome = await runAdaptive(Date.now())
        const [g, t, w] = await Promise.all([
          currentGoal(),
          dayTotals(localDate(selected)),
          exerciseOn(localDate(selected)).catch(() => [] as ExerciseEntry[]),
        ])
        if (!alive) return
        setAdaptive(outcome)
        setGoal(g)
        setTotals(t)
        setWorkouts(w)
      })()
      return () => {
        alive = false
      }
    }, [selected, round]),
  )

  function removeWorkout(w: ExerciseEntry) {
    Alert.alert('Remove this workout?', w.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void deleteExercise(w.id).finally(() => setRound((n) => n + 1)),
      },
    ])
  }

  if (!goal || !totals) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.body, { color: theme.textMuted }]}>Loading your day…</Text>
      </View>
    )
  }

  const remaining = goal.targetKcal - totals.kcal
  const over = remaining < 0
  const pct = goal.targetKcal > 0 ? totals.kcal / goal.targetKcal : 0
  const empty = totals.mealCount === 0 && totals.pendingCount === 0
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: 150 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.wordmark, { color: theme.text }]}>{APP_NAME}</Text>
        </View>

        {/* Day strip */}
        <DayStrip selected={offset} onSelect={setOffset} />

        {/* Calories and the three macros, all from the food log. */}
        <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
          <View style={[styles.heroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.hero, { color: theme.text }]}>
                {Math.abs(Math.round(remaining))}
              </Text>
              <Text style={[type.body, { color: theme.textMuted }]}>
                {over ? 'Calories over' : 'Calories left'}
              </Text>
            </View>
            <Ring pct={pct} over={over} size={128} stroke={12}>
              <Icon name="flame" size={26} color={theme.text} />
            </Ring>
          </View>

          <View style={styles.macroRow}>
            <MacroCard label="Protein" icon="protein" eaten={totals.protein_g} target={goal.protein_g} color={theme.protein} />
            <MacroCard label="Carbs" icon="carbs" eaten={totals.carbs_g} target={goal.carbs_g} color={theme.carbs} />
            <MacroCard label="Fat" icon="fat" eaten={totals.fat_g} target={goal.fat_g} color={theme.fat} />
          </View>
        </View>

        {/* Adaptive target status — always legible, never a silent change. */}
        <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
          <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="target" size={18} color={theme.text} />
              <Text style={[type.bodyStrong, { color: theme.text }]}>Your target</Text>
            </View>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              {adaptive?.surfaced
                ? `Updated to ${Math.round(adaptive.newKcal ?? 0)} kcal. ${adaptive.explanation}`
                : goal.adaptive
                  ? (adaptive?.reason ?? 'Adapting from your own trend and intake.')
                  : 'Fixed — you set this by hand, so we leave it alone.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/log-weight' as never)}
              style={[tap, { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm }]}
            >
              <Icon name="scale" size={16} color={theme.protein} />
              <Text style={[type.label, { color: theme.protein }]}>Log today's weight</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/log-exercise' as never)}
              style={[tap, { flexDirection: 'row', alignItems: 'center', gap: space.xs }]}
            >
              <Icon name="dumbbell" size={16} color={theme.protein} />
              <Text style={[type.label, { color: theme.protein }]}>Log exercise</Text>
            </Pressable>
          </View>
        </View>

        {/* Exercise logged on the selected day (blind test round 1, B10). */}
        {workouts.length > 0 ? (
          <View style={{ paddingHorizontal: space.lg, marginTop: space.xl }}>
            <Text style={[type.title, { color: theme.text, fontSize: 24 }]}>Exercise</Text>
            <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent', marginTop: space.md }]}>
              {workouts.map((w) => (
                <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}>
                  <Icon name="dumbbell" size={18} color={theme.text} />
                  <Text style={[type.body, { color: theme.text, flex: 1 }]} numberOfLines={2}>
                    {w.name}
                  </Text>
                  <Text style={[type.bodyStrong, { color: theme.text }]}>{Math.round(w.kcal)} kcal</Text>
                  {w.provenance === 'manual' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${w.name}`}
                      onPress={() => removeWorkout(w)}
                      style={tapIcon}
                    >
                      <Icon name="close" size={16} color={theme.textFaint} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 19 }]}>
                Calories burned are an estimate. They do not change your daily target.
              </Text>
            </View>
          </View>
        ) : null}

        {/* Recently uploaded */}
        <View style={{ paddingHorizontal: space.lg, marginTop: space.xl }}>
          <Text style={[type.title, { color: theme.text, fontSize: 24 }]}>Recently uploaded</Text>

          {empty ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.bgSunken }]}>
              <View style={[styles.ghostRow, { backgroundColor: theme.bgElevated }]}>
                <Icon name="bowl" size={26} color={theme.textFaint} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={[styles.skeleton, { backgroundColor: theme.ringTrack, width: '70%' }]} />
                  <View style={[styles.skeleton, { backgroundColor: theme.ringTrack, width: '45%' }]} />
                </View>
              </View>
              <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: space.lg }]}>
                Tap + to add your first meal of the day
              </Text>
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
              <Text style={[type.bodyStrong, { color: theme.text }]}>
                {totals.mealCount} {totals.mealCount === 1 ? 'meal' : 'meals'} logged
              </Text>
              {totals.pendingCount > 0 ? (
                <Text style={[type.caption, { color: theme.uncertain, marginTop: space.xs }]}>
                  +{totals.pendingCount} still analyzing — not counted yet
                </Text>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
      <StatusBarScrim />
    </View>
  )
}

function DayStrip({ selected, onSelect }: { selected: number; onSelect: (o: number) => void }) {
  const theme = useTheme()
  const now = new Date()
  // Monday-first week containing today.
  const dow = (now.getDay() + 6) % 7
  const days = Array.from({ length: 7 }, (_, i) => i - dow)

  return (
    <View style={styles.strip}>
      {days.map((off) => {
        const d = new Date(Date.now() + off * 86_400_000)
        const isSel = off === selected
        const future = off > 0
        return (
          <Pressable
            key={off}
            disabled={future}
            onPress={() => onSelect(off)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSel, disabled: future }}
            style={[styles.dayCol, isSel && { backgroundColor: theme.bgElevated }]}
          >
            <Text style={[type.caption, { color: future ? theme.textFaint : theme.textMuted }]}>
              {DAY_LABELS[d.getDay()]}
            </Text>
            <View
              style={[
                styles.dayCircle,
                {
                  borderColor: isSel ? theme.text : theme.border,
                  borderStyle: off < 0 ? 'dashed' : 'solid',
                  opacity: future ? 0.4 : 1,
                },
              ]}
            >
              <Text style={[type.bodyStrong, { color: future ? theme.textFaint : theme.text }]}>
                {d.getDate()}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function Ring({
  pct, over, size, stroke, children,
}: {
  pct: number
  over: boolean
  size: number
  stroke: number
  children?: React.ReactNode
}) {
  const theme = useTheme()
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  const primary = Math.min(1, pct)
  const overflow = over ? Math.min(1, pct - 1) : 0
  const innerR = r - stroke - 3
  const innerC = 2 * Math.PI * innerR

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.ringTrack} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={theme.ring} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c * primary} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {overflow > 0 ? (
          <Circle
            cx={size / 2} cy={size / 2} r={innerR}
            stroke={theme.uncertain} strokeWidth={stroke * 0.6} fill="none"
            strokeDasharray={`${innerC * overflow} ${innerC}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  )
}

function MacroCard({
  label, icon, eaten, target, color, unit = 'g',
}: {
  label: string
  icon: IconName
  eaten: number
  target: number
  color: string
  unit?: string
}) {
  const theme = useTheme()
  const left = Math.max(0, target - eaten)
  const pct = target > 0 ? Math.min(1, eaten / target) : 0
  const size = 74
  const r = size / 2 - 5
  const c = 2 * Math.PI * r

  return (
    <View style={[styles.macroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
      {/* "2300mg" must shrink, never wrap — a two-line number reads broken. */}
      <Text style={[styles.macroNum, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {Math.round(left)}
        {unit}
      </Text>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label} left</Text>

      <View style={{ alignItems: 'center', marginTop: space.md }}>
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.ringTrack} strokeWidth={5} fill="none" />
            <Circle
              cx={size / 2} cy={size / 2} r={r}
              stroke={color} strokeWidth={5} fill="none"
              strokeDasharray={`${c * pct} ${c}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </Svg>
          <Icon name={icon} size={22} color={color} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: -1.2 },
  strip: { flexDirection: 'row', paddingHorizontal: space.md, marginTop: space.lg },
  dayCol: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, gap: space.sm },
  dayCircle: {
    width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.xl,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hero: { fontSize: 46, fontWeight: '800', letterSpacing: -1.8 },
  macroRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  macroCard: {
    flex: 1,
    padding: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  macroNum: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6 },
  card: { padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  emptyCard: { marginTop: space.md, padding: space.lg, borderRadius: radius.xl },
  ghostRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg,
  },
  skeleton: { height: 8, borderRadius: 4 },
})
