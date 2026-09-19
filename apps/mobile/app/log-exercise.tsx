import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ExerciseEstimateZ } from '@nutai/core-schema'
import { Icon, type IconName } from '../src/components/Icon'
import { db, localDate, setting, weightHistory } from '../src/data/repo'
import {
  exerciseKcal,
  INTENSITY_ANCHORS,
  type ExerciseKind,
  type Intensity,
} from '../src/exercise/met'
import { runExerciseEstimate } from '../src/inference/pathA/client'
import { notePublikWallet, publikAvailable } from '../src/inference/publik'
import { DISCONNECTED_MESSAGE } from '../src/inference/publik-copy'
import { baseUrlOf, resolveInference } from '../src/inference/resolve'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Log exercise — the four-path flow.
 *
 * Run and Weight lifting are DETERMINISTIC: MET x body weight x minutes, the
 * same three intensity anchors the incumbent shows, no model anywhere.
 * Describe is the one model-owned path and says so on screen. Manual is the
 * user's own number, recorded verbatim.
 *
 * Everything lands in exercise_entries with provenance 'manual' (typed here,
 * as opposed to imported from Apple Health) so the HealthKit reader can never
 * double-count a workout that was also typed in.
 */

type Step =
  | { kind: 'menu' }
  | { kind: 'intensity'; exercise: ExerciseKind }
  | { kind: 'describe' }
  | { kind: 'manual' }

const MENU: Array<{ step: Step; icon: IconName; title: string; sub: string }> = [
  { step: { kind: 'intensity', exercise: 'run' }, icon: 'run', title: 'Run', sub: 'Running, jogging, sprinting, etc.' },
  { step: { kind: 'intensity', exercise: 'weights' }, icon: 'dumbbell', title: 'Weight lifting', sub: 'Machines, free weights, etc.' },
  { step: { kind: 'describe' }, icon: 'pencil', title: 'Describe', sub: 'Write your workout in text' },
  { step: { kind: 'manual' }, icon: 'flame', title: 'Manual', sub: 'Enter exactly how many calories you burned' },
]

const KIND_META: Record<ExerciseKind, { icon: IconName; title: string }> = {
  run: { icon: 'run', title: 'Run' },
  weights: { icon: 'dumbbell', title: 'Weight lifting' },
}

const DURATIONS = [15, 30, 60, 90] as const

async function latestWeightKg(): Promise<number> {
  const points = await weightHistory()
  return points[points.length - 1]?.weightKg ?? 80
}

async function saveEntry(name: string, kcal: number): Promise<void> {
  const now = Date.now()
  const h = await db()
  await h.run(
    `INSERT INTO exercise_entries (local_date, name, kcal, provenance, external_id, logged_at)
     VALUES (?,?,?,'manual',NULL,?)`,
    [localDate(now), name, kcal, now],
  )
}

export default function LogExercise() {
  const [step, setStep] = useState<Step>({ kind: 'menu' })

  if (step.kind === 'intensity') {
    return <IntensityScreen exercise={step.exercise} onBack={() => setStep({ kind: 'menu' })} />
  }
  if (step.kind === 'describe') return <DescribeScreen onBack={() => setStep({ kind: 'menu' })} />
  if (step.kind === 'manual') return <ManualScreen onBack={() => setStep({ kind: 'menu' })} />
  return <MenuScreen onPick={setStep} />
}

function Header({ title, icon, onBack }: { title: string; icon?: IconName; onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={[styles.backBtn, { backgroundColor: theme.bgSunken }]}
      >
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="chevron" size={18} color={theme.text} />
        </View>
      </Pressable>
      <View style={styles.headerTitle}>
        {icon ? <Icon name={icon} size={20} color={theme.text} /> : null}
        <Text style={[type.bodyStrong, { color: theme.text, fontSize: 17 }]}>{title}</Text>
      </View>
      <View style={{ width: 44 }} />
    </View>
  )
}

function MenuScreen({ onPick }: { onPick: (s: Step) => void }) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="Exercise" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        <Text style={[type.title, { color: theme.text, fontSize: 34 }]}>Log Exercise</Text>

        <View style={{ marginTop: space.xl, gap: space.md }}>
          {MENU.map((m) => (
            <Pressable
              key={m.title}
              accessibilityRole="button"
              onPress={() => onPick(m.step)}
              style={[styles.optionCard, { backgroundColor: theme.bgSunken }]}
            >
              <Icon name={m.icon} size={26} color={theme.text} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: theme.text, fontSize: 17 }]}>{m.title}</Text>
                <Text style={[type.body, { color: theme.textMuted, marginTop: 2 }]}>{m.sub}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

function IntensityScreen({ exercise, onBack }: { exercise: ExerciseKind; onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [level, setLevel] = useState<Intensity>('medium')
  const [minutes, setMinutes] = useState('15')
  const [saving, setSaving] = useState(false)

  const anchors = INTENSITY_ANCHORS[exercise]
  const mins = Number.parseInt(minutes, 10)
  const valid = Number.isFinite(mins) && mins > 0 && mins <= 600
  // Thumb sits at the selected anchor: index 0 (high) at the top.
  const idx = anchors.findIndex((a) => a.level === level)

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    const kg = await latestWeightKg()
    const kcal = exerciseKcal(exercise, level, kg, mins)
    await saveEntry(`${KIND_META[exercise].title} — ${level}, ${mins} min`, kcal)
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={KIND_META[exercise].title} icon={KIND_META[exercise].icon} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        <View style={styles.sectionHead}>
          <Icon name="sun" size={20} color={theme.text} />
          <Text style={[type.title, { color: theme.text, fontSize: 26 }]}>Set intensity</Text>
        </View>

        <View style={[styles.intensityCard, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flex: 1, gap: space.xl }}>
            {anchors.map((a) => {
              const active = a.level === level
              return (
                <Pressable key={a.level} onPress={() => setLevel(a.level)} hitSlop={space.sm}>
                  <Text style={[active ? type.heading : type.bodyStrong, { color: active ? theme.text : theme.textMuted }]}>
                    {a.title}
                  </Text>
                  <Text
                    style={[
                      active ? type.bodyStrong : type.body,
                      { color: active ? theme.text : theme.textFaint, marginTop: 2, lineHeight: 20 },
                    ]}
                  >
                    {a.desc}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {/* The level track: three tap zones, thumb at the active third. */}
          <View style={styles.track}>
            <View style={[styles.trackLine, { backgroundColor: theme.text }]} />
            {anchors.map((a, i) => (
              <Pressable
                key={a.level}
                accessibilityRole="button"
                accessibilityLabel={`${a.title} intensity`}
                onPress={() => setLevel(a.level)}
                style={[styles.trackZone, { top: `${(i * 100) / 3}%` as const }]}
              />
            ))}
            <View
              pointerEvents="none"
              style={[
                styles.thumb,
                { backgroundColor: theme.text, borderColor: theme.bg, top: `${(idx * 100) / 3 + 8}%` as const },
              ]}
            />
          </View>
        </View>

        <View style={[styles.sectionHead, { marginTop: space.xl }]}>
          <Icon name="clock" size={20} color={theme.text} />
          <Text style={[type.title, { color: theme.text, fontSize: 26 }]}>Duration</Text>
        </View>

        <View style={styles.chipRow}>
          {DURATIONS.map((d) => {
            const active = minutes === String(d)
            return (
              <Pressable
                key={d}
                onPress={() => setMinutes(String(d))}
                style={[
                  styles.chip,
                  active
                    ? { backgroundColor: theme.text }
                    : { borderWidth: 1.5, borderColor: theme.text },
                ]}
              >
                <Text style={[type.bodyStrong, { color: active ? theme.bg : theme.text }]}>{d} mins</Text>
              </Pressable>
            )
          })}
        </View>

        <TextInput
          accessibilityLabel="Duration in minutes"
          keyboardType="number-pad"
          value={minutes}
          onChangeText={setMinutes}
          style={[styles.minutesInput, { color: theme.text, borderColor: theme.border }]}
        />
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={save}
          disabled={!valid || saving}
          style={[styles.cta, { backgroundColor: valid ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>
            {saving ? 'Saving…' : 'Continue'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function DescribeScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viaPublik, setViaPublik] = useState(false)

  useEffect(() => {
    void setting('provider').then((p) => setViaPublik(p === 'publik'))
  }, [])

  async function add() {
    const desc = text.trim()
    if (!desc || busy) return
    setBusy(true)
    setError(null)

    const r = await resolveInference()
    if (!r.ok) {
      setBusy(false)
      setError(
        r.error.kind === 'publik-disconnected'
          ? DISCONNECTED_MESSAGE
          : r.error.kind === 'key-missing'
            ? 'Your saved key is missing. Re-enter it in Profile.'
            : `Describing a workout needs ${publikAvailable() ? 'publik API or ' : ''}an AI key — connect one in Profile, or use Run, Weight lifting or Manual instead.`,
      )
      return
    }

    const kg = await latestWeightKg()
    const outcome = await runExerciseEstimate(
      r.value.dialect,
      { model: r.value.textModel, description: desc, weightKg: kg, ...baseUrlOf(r.value) },
      r.value.credential,
    )
    if (outcome.wallet) void notePublikWallet(outcome.wallet)
    const parsed = outcome.ok ? ExerciseEstimateZ.safeParse(outcome.raw) : null

    if (!parsed?.success) {
      setBusy(false)
      setError(outcome.ok ? 'Could not turn that into an estimate — try adding a duration.' : (outcome.error?.message ?? 'The estimate failed.'))
      return
    }

    const e = parsed.data
    await saveEntry(e.duration_min ? `${e.label} — ${Math.round(e.duration_min)} min` : e.label, Math.round(e.calories_kcal))
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="Describe Exercise" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
        <TextInput
          autoFocus
          placeholder="Describe workout time, intensity, etc."
          placeholderTextColor={theme.textFaint}
          value={text}
          onChangeText={(t) => {
            setText(t)
            setError(null)
          }}
          style={[styles.describeInput, { color: theme.text, borderColor: theme.border }]}
        />

        <View style={[styles.aiPill, { borderColor: theme.border }]}>
          <Icon name="scan" size={14} color={theme.text} />
          <Text style={[type.label, { color: theme.text }]}>
            {viaPublik ? 'Estimated with publik API' : 'Estimated with your API key'}
          </Text>
        </View>

        <View style={[styles.example, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.body, { color: theme.textMuted, lineHeight: 22 }]}>
            <Text style={{ fontWeight: '700', color: theme.text }}>Example:</Text> Leg strength
            training for 35 mins, 9/10 intensity
          </Text>
        </View>

        {error ? (
          <View style={[styles.example, { backgroundColor: theme.safetyBg, marginTop: space.md }]}>
            <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          </View>
        ) : null}

        {busy ? <ActivityIndicator color={theme.textMuted} style={{ marginTop: space.xl }} /> : null}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={add}
          disabled={!text.trim() || busy}
          style={[styles.cta, { backgroundColor: text.trim() && !busy ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>
            {busy ? 'Estimating…' : 'Add Exercise'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function ManualScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [kcal, setKcal] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const n = Number.parseInt(kcal, 10)
  const valid = Number.isFinite(n) && n > 0 && n <= 5000

  async function add() {
    if (!valid || saving) return
    setSaving(true)
    await saveEntry(name.trim() || 'Workout', n)
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="Manual" icon="flame" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={[type.label, { color: theme.textMuted }]}>Calories burned</Text>
        <TextInput
          autoFocus
          accessibilityLabel="Calories burned"
          keyboardType="number-pad"
          placeholder="250"
          placeholderTextColor={theme.textFaint}
          value={kcal}
          onChangeText={setKcal}
          style={[styles.minutesInput, { color: theme.text, borderColor: theme.border, marginTop: space.sm }]}
        />

        <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Name (optional)</Text>
        <TextInput
          accessibilityLabel="Exercise name"
          placeholder="Workout"
          placeholderTextColor={theme.textFaint}
          value={name}
          onChangeText={setName}
          style={[styles.minutesInput, { color: theme.text, borderColor: theme.border, marginTop: space.sm, fontSize: 17, fontWeight: '400' }]}
        />

        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          Recorded exactly as entered. Your number, your log.
        </Text>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={add}
          disabled={!valid || saving}
          style={[styles.cta, { backgroundColor: valid ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Add Exercise</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    minHeight: 84,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  intensityCard: {
    flexDirection: 'row',
    gap: space.lg,
    marginTop: space.lg,
    padding: space.lg,
    paddingVertical: space.xl,
    borderRadius: radius.lg,
  },
  track: { width: 28, alignItems: 'center', position: 'relative' },
  trackLine: { width: 8, flex: 1, borderRadius: 4, opacity: 0.9 },
  trackZone: { position: 'absolute', left: -space.md, right: -space.md, height: '33%' },
  thumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  minutesInput: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    fontSize: 20,
    fontWeight: '700',
    minHeight: 56,
  },
  describeInput: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    fontSize: 17,
    minHeight: 56,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    marginTop: space.lg,
  },
  example: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
