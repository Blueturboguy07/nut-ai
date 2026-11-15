import Svg, { Circle, Defs, LinearGradient, Path, Stop, Line as SvgLine } from 'react-native-svg'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/ThemeProvider'
import { ESTIMATE_NOT_PROMISE } from '../../onboarding/goal-copy'
import { radius, space, type } from '../../theme/tokens'

/**
 * The two onboarding charts, hand-rolled in react-native-svg.
 *
 * No chart library: these are fixed shapes with no axes, legends or
 * interaction, and a library would import an opinionated axis/legend system to
 * fight. A cubic path plus a gradient fill is about forty lines.
 *
 * Blind test round 1, Nov 14 2026 (B6): both are projections of weight LOSS,
 * so the screens show them only when the goal is to lose weight, and each
 * carries the label "Estimate, not a promise" (EstimateLabel). The chart of
 * this app against "Without a plan" is removed: it was an ad.
 */

/** Smooth cubic through points, used by both charts. */
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

/** The label on every projection: a shape from arithmetic, not a forecast of this person. */
function EstimateLabel() {
  const theme = useTheme()
  return (
    <View style={[styles.pill, { alignSelf: 'flex-start', marginTop: space.xs, backgroundColor: theme.uncertainBg }]}>
      <Text style={[type.micro, { color: theme.uncertain }]}>{ESTIMATE_NOT_PROMISE}</Text>
    </View>
  )
}

/** How weight loss often goes: slow at first, then steadier. Only for a goal to lose weight. */
export function TransitionChart() {
  const theme = useTheme()
  const pts = [{ x: 12, y: 30 }, { x: 90, y: 44 }, { x: 175, y: 100 }, { x: 285, y: 132 }]
  const d = smoothPath(pts)

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <Text style={[type.heading, { color: theme.text }]}>How weight loss often goes</Text>
      <EstimateLabel />

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
        A general shape, not a forecast for you. Your own trend shows in Progress.
      </Text>
    </View>
  )
}

/** The plan screen's estimated curve to the goal weight. Only for a goal to lose weight. */
export function ProgressChart({ targetLabel, dateLabel }: { targetLabel: string; dateLabel: string }) {
  const theme = useTheme()
  const pts = [{ x: 12, y: 30 }, { x: 110, y: 42 }, { x: 200, y: 112 }, { x: 270, y: 130 }]
  const d = smoothPath(pts)
  const end = pts[3]!

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <Text style={[type.heading, { color: theme.text }]}>Estimated progress</Text>
      <EstimateLabel />

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
        <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>About {dateLabel}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderRadius: radius.xl },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },
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
