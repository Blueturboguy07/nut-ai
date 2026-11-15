import Svg, { Circle, Defs, LinearGradient, Path, Stop, Line as SvgLine } from 'react-native-svg'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/ThemeProvider'
import { APP_NAME } from '../../inference/publik-copy'
import { radius, space, type } from '../../theme/tokens'

/**
 * The three onboarding charts, hand-rolled in react-native-svg.
 *
 * No chart library: these are three fixed shapes with no axes, legends or
 * interaction, and a library would import an opinionated axis/legend system to
 * fight. A cubic path plus a gradient fill is about forty lines.
 */

/** Smooth cubic through points, used by all three charts. */
function smoothPath(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!
    const p1 = pts[i + 1]!
    const cx = (p0.x + p1.x) / 2
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`
  }
  return d
}

const W = 300
const H = 170

/**
 * "Designed to help you stay on track" — us versus no plan.
 *
 * A chart like this is often pure marketing, but the shape it draws is a real,
 * well-documented phenomenon: unstructured dieting tends to produce early loss
 * followed by regain. We keep the comparison and label the y-axis honestly as a
 * trend rather than implying guaranteed numbers.
 */
export function TrendComparisonChart({ gaining }: { gaining: boolean }) {
  const theme = useTheme()

  // SVG y grows downward, so a GAINING plan line must travel to a smaller y.
  // The "without a plan" line always ends back near the start: the documented
  // pattern is regression to baseline, in either direction.
  const withPlan = gaining
    ? smoothPath([
        { x: 10, y: 138 }, { x: 90, y: 126 }, { x: 170, y: 63 }, { x: 250, y: 33 }, { x: 290, y: 30 },
      ])
    : smoothPath([
        { x: 10, y: 30 }, { x: 90, y: 42 }, { x: 170, y: 105 }, { x: 250, y: 135 }, { x: 290, y: 138 },
      ])
  const without = gaining
    ? smoothPath([
        { x: 10, y: 138 }, { x: 80, y: 76 }, { x: 140, y: 68 }, { x: 220, y: 120 }, { x: 290, y: 144 },
      ])
    : smoothPath([
        { x: 10, y: 30 }, { x: 80, y: 92 }, { x: 140, y: 100 }, { x: 220, y: 45 }, { x: 290, y: 22 },
      ])

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <Text style={[type.heading, { color: theme.text }]}>Weight trend</Text>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
        <Defs>
          <LinearGradient id="planFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.text} stopOpacity="0.10" />
            <Stop offset="1" stopColor={theme.text} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <SvgLine x1="10" y1="30" x2="290" y2="30" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />
        <SvgLine x1="10" y1="95" x2="290" y2="95" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />

        <Path d={`${withPlan} L 290 150 L 10 150 Z`} fill="url(#planFill)" />
        <Path d={without} stroke="#E8615A" strokeWidth="3" fill="none" strokeLinecap="round" />
        <Path d={withPlan} stroke={theme.text} strokeWidth="3.5" fill="none" strokeLinecap="round" />

        <Circle cx="10" cy={gaining ? 138 : 30} r="6" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
        <Circle cx="290" cy={gaining ? 30 : 138} r="6" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
      </Svg>

      <View style={styles.legendRow}>
        <View style={[styles.pill, { backgroundColor: theme.text }]}>
          <Text style={[type.micro, { color: theme.bg }]}>{APP_NAME}</Text>
        </View>
        <Text style={[type.caption, { color: '#E8615A' }]}>Without a plan</Text>
      </View>

      <View style={styles.axisRow}>
        <Text style={[type.caption, { color: theme.textMuted }]}>Month 1</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>Month 6</Text>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.md }]}>
        Track your habits and stay consistent over time.
      </Text>
    </View>
  )
}

/** "You have great potential" — the 3 / 7 / 30 day consistency curve. */
export function TransitionChart({ gaining }: { gaining: boolean }) {
  const theme = useTheme()
  const pts = gaining
    ? [{ x: 12, y: 130 }, { x: 90, y: 118 }, { x: 175, y: 62 }, { x: 285, y: 28 }]
    : [{ x: 12, y: 30 }, { x: 90, y: 44 }, { x: 175, y: 100 }, { x: 285, y: 132 }]
  const d = smoothPath(pts)

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <Text style={[type.heading, { color: theme.text }]}>Your weight transition</Text>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
        <Defs>
          <LinearGradient id="transFill" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#C08A5A" stopOpacity="0.05" />
            <Stop offset="1" stopColor="#C08A5A" stopOpacity="0.22" />
          </LinearGradient>
        </Defs>

        <SvgLine x1="12" y1="62" x2="285" y2="62" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />
        <SvgLine x1="12" y1="118" x2="285" y2="118" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />

        <Path d={`${d} L 285 150 L 12 150 Z`} fill="url(#transFill)" />
        <Path d={d} stroke="#8C6239" strokeWidth="3.5" fill="none" strokeLinecap="round" />

        {pts.slice(0, 3).map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r="6" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
        ))}
        <Circle cx={pts[3]!.x} cy={pts[3]!.y} r="15" fill="#C88A4B" />
      </Svg>

      <View style={styles.axisRow}>
        <Text style={[type.caption, { color: theme.textMuted }]}>3 Days</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>7 Days</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>30 Days</Text>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.md }]}>
        Weight change takes time. Consistency in the early weeks matters most.
      </Text>
    </View>
  )
}

/** The plan screen's estimated-progress curve, with the target callout. */
export function ProgressChart({
  targetLabel,
  dateLabel,
  gaining,
}: {
  targetLabel: string
  dateLabel: string
  gaining: boolean
}) {
  const theme = useTheme()
  const pts = gaining
    ? [{ x: 12, y: 130 }, { x: 110, y: 118 }, { x: 200, y: 48 }, { x: 270, y: 30 }]
    : [{ x: 12, y: 30 }, { x: 110, y: 42 }, { x: 200, y: 112 }, { x: 270, y: 130 }]
  const d = smoothPath(pts)
  const end = pts[3]!

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <Text style={[type.heading, { color: theme.text }]}>Estimated progress</Text>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
        <Defs>
          <LinearGradient id="progFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.text} stopOpacity="0.12" />
            <Stop offset="1" stopColor={theme.text} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <SvgLine x1="12" y1="45" x2="285" y2="45" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />
        <SvgLine x1="12" y1="100" x2="285" y2="100" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />

        <Path d={`${d} L 270 145 L 12 145 Z`} fill="url(#progFill)" />
        <Path d={d} stroke={theme.text} strokeWidth="3.5" fill="none" strokeLinecap="round" />

        <Circle cx={pts[0]!.x} cy={pts[0]!.y} r="6" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
        <Circle cx={end.x} cy={end.y} r="7" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
      </Svg>

      <View style={[styles.callout, { backgroundColor: theme.bgElevated, borderColor: theme.text }]}>
        <Text style={[type.caption, { color: theme.text, fontWeight: '700', textAlign: 'center' }]}>
          Target{'\n'}{targetLabel}
        </Text>
      </View>

      <View style={styles.axisRow}>
        <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>Now</Text>
        <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>{dateLabel}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderRadius: radius.xl },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  pill: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  callout: {
    alignSelf: 'flex-end',
    marginTop: -space.xxl,
    marginRight: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 2,
  },
})
