import * as Haptics from 'expo-haptics'
import Svg, { Defs, Pattern, Rect } from 'react-native-svg'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Icon, type IconName } from '../Icon'
import { useTheme } from '../../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../theme/tokens'

/**
 * The three input controls the onboarding flow needs: a selectable option
 * card, a segmented unit toggle, and the two value pickers (a horizontal ruler
 * and a vertical wheel).
 */

// ---------------------------------------------------------------------------

export function OptionCard({
  label,
  sublabel,
  glyph,
  selected,
  onPress,
}: {
  label: string
  sublabel?: string
  glyph: IconName
  selected: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={[
        styles.card,
        {
          backgroundColor: theme.bgElevated,
          borderColor: selected ? theme.text : theme.border,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.glyphCircle, { backgroundColor: theme.isDark ? theme.bgSunken : '#F3F2F8' }]}>
        <Icon name={glyph} size={24} color={theme.text} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={[styles.cardLabel, { color: theme.text }]}>{label}</Text>
        {sublabel ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{sublabel}</Text>
        ) : null}
      </View>

      <View style={[styles.radioOuter, { borderColor: selected ? theme.text : theme.border }]}>
        {selected ? <View style={[styles.radioInner, { backgroundColor: theme.text }]} /> : null}
      </View>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  const theme = useTheme()
  return (
    <View style={[styles.segmentWrap, { backgroundColor: theme.isDark ? theme.bgSunken : '#F0F0F3' }]}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              void Haptics.selectionAsync()
              onChange(o.value)
            }}
            style={[
              styles.segment,
              active && { backgroundColor: theme.bgElevated, ...styles.segmentActive },
            ]}
          >
            <Text
              style={[
                type.bodyStrong,
                { color: active ? theme.text : theme.textMuted, fontSize: 17 },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ---------------------------------------------------------------------------

/**
 * Pixels per WHOLE unit (1 lb or 1 kg), not per step.
 *
 * These are deliberately decoupled. Drawing one tick per 0.1 step across a
 * 60-500 lb range is 4,401 ticks; the first version of this component mounted a
 * nested View for each, i.e. ~8,800 native views on one screen, which is enough
 * to stall the entire app for seconds. Ticks are now drawn once per unit, and
 * 0.1 precision comes from the scroll offset rather than from tick count.
 */
const PX_PER_UNIT = 12

/**
 * Horizontal ruler picker, used for both weight screens.
 *
 * The scroll position IS the value — there is no separate thumb to drift out of
 * sync with the number above it.
 *
 * THE THING THAT MAKES THIS FEEL RESPONSIVE, and which is easy to get wrong:
 * `contentOffset` is NOT passed as a controlled prop. Doing that creates a fight —
 * every scroll frame updates state, the re-render reasserts the old offset, and
 * the gesture stutters or refuses to start. The initial position is set once
 * imperatively, and afterwards the scroll view owns its own offset. State flows
 * out of the gesture, never back into it.
 *
 * The one exception is a genuinely EXTERNAL change, such as typing a number or
 * switching units. `lastEmitted` distinguishes "this value came from my own
 * scroll" (ignore) from "something else set this" (scroll to it).
 */
export function RulerPicker({
  min,
  max,
  step,
  value,
  onChange,
  width,
}: {
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  width: number
}) {
  const theme = useTheme()
  const scrollRef = useRef<ScrollView>(null)
  const lastEmitted = useRef<number | null>(null)
  const lastHaptic = useRef(Math.round(value))
  const didInit = useRef(false)

  const units = max - min
  const contentWidth = units * PX_PER_UNIT
  const sidePad = width / 2

  const offsetFor = useCallback((v: number) => (v - min) * PX_PER_UNIT, [min])

  const onLayout = useCallback(() => {
    if (didInit.current) return
    didInit.current = true
    scrollRef.current?.scrollTo({ x: offsetFor(value), animated: false })
  }, [offsetFor, value])

  // External changes only — typing a value, or a unit switch that rescales.
  useEffect(() => {
    if (!didInit.current) return
    if (lastEmitted.current != null && Math.abs(lastEmitted.current - value) < step / 2) return
    scrollRef.current?.scrollTo({ x: offsetFor(value), animated: false })
  }, [value, offsetFor, step])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x
      const raw = min + x / PX_PER_UNIT
      const snapped = Math.round(raw / step) * step
      const next = Math.min(max, Math.max(min, Number(snapped.toFixed(2))))
      if (lastEmitted.current != null && Math.abs(lastEmitted.current - next) < step / 2) return
      lastEmitted.current = next
      onChange(next)
      const whole = Math.round(next)
      if (whole !== lastHaptic.current) {
        lastHaptic.current = whole
        void Haptics.selectionAsync()
      }
    },
    [max, min, onChange, step],
  )

  const tickColor = theme.isDark ? theme.textFaint : '#1A1A1F'

  // The ruler artwork depends only on range and colour, never on the value. Held
  // in a memo so a scroll frame reconciles one cached element instead of
  // rebuilding the SVG tree 60 times a second.
  const ruler = useMemo(
    () => (
      <Svg width={contentWidth} height={76}>
        <Defs>
          <Pattern id="minor" x={0} y={0} width={PX_PER_UNIT} height={76} patternUnits="userSpaceOnUse">
            <Rect x={0} y={0} width={1.5} height={28} fill={tickColor} opacity={0.45} />
          </Pattern>
          <Pattern id="major" x={0} y={0} width={PX_PER_UNIT * 10} height={76} patternUnits="userSpaceOnUse">
            <Rect x={0} y={0} width={1.5} height={56} fill={tickColor} opacity={0.9} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={contentWidth} height={76} fill="url(#minor)" />
        <Rect x={0} y={0} width={contentWidth} height={76} fill="url(#major)" />
      </Svg>
    ),
    [contentWidth, tickColor],
  )

  return (
    <View style={{ height: 150 }} onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="normal"
        onScroll={onScroll}
        // One frame. The default (0) fires only at gesture start and end, which
        // is its own way of making a ruler feel dead while you drag it.
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        style={{ height: 110 }}
      >
        {/*
          The whole ruler is ONE native view.

          Two tiled SVG patterns — a minor tick every unit and a major tick every
          ten — instead of a View per tick. The previous version mounted ~8,800
          views here and stalled the app; this is a single GPU-composited node
          regardless of range.
        */}
        {ruler}
      </ScrollView>

      {/* The fixed read-out line. The value is whatever sits under it. */}
      <View pointerEvents="none" style={[styles.rulerCursor, { left: sidePad - 1 }]}>
        <View style={{ width: 2.5, height: 76, backgroundColor: theme.text, borderRadius: 2 }} />
      </View>
    </View>
  )
}

/**
 * The big read-out above a picker, tappable to type an exact value.
 *
 * Scrolling to 187.3 lbs on a ruler is genuinely tedious when you already know
 * the number off a scale. Tapping the value swaps in a numeric field; committing
 * clamps to range and scrolls the ruler to match, so the two never disagree.
 */
export function EditableValue({
  value,
  unit,
  min,
  max,
  onCommit,
  label,
}: {
  value: number
  unit: string
  min: number
  max: number
  onCommit: (v: number) => void
  label?: string
}) {
  const theme = useTheme()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const commit = () => {
    const parsed = Number.parseFloat(draft.replace(',', '.'))
    if (Number.isFinite(parsed)) {
      // Clamp rather than reject. Someone typing 900 lbs has made a typo, and
      // silently discarding their input teaches them the field is broken.
      onCommit(Math.min(max, Math.max(min, parsed)))
    }
    setEditing(false)
  }

  return (
    <View style={{ alignItems: 'center' }}>
      {label ? <Text style={[type.body, { color: theme.textMuted }]}>{label}</Text> : null}

      {editing ? (
        <View style={styles.editRow}>
          <TextInput
            autoFocus
            selectTextOnFocus
            keyboardType="decimal-pad"
            returnKeyType="done"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={commit}
            onBlur={commit}
            accessibilityLabel={`${label ?? 'Value'} in ${unit}`}
            style={[
              styles.editInput,
              { color: theme.text, borderBottomColor: theme.text },
            ]}
          />
          <Text style={[styles.readoutUnit, { color: theme.text }]}> {unit}</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${value.toFixed(1)} ${unit}. Tap to type an exact value.`}
          hitSlop={space.md}
          onPress={() => {
            void Haptics.selectionAsync()
            setDraft(value.toFixed(1))
            setEditing(true)
          }}
          style={styles.editRow}
        >
          <Text style={[styles.readoutValue, { color: theme.text }]}>
            {value.toFixed(1)} {unit}
          </Text>
          <View style={{ marginLeft: space.sm }}>
            <Icon name="pencil" size={16} color={theme.textFaint} />
          </View>
        </Pressable>
      )}

      {!editing ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xs }]}>
          Tap to type
        </Text>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------------

const ROW_HEIGHT = 46

/** Vertical wheel picker, used for height and date of birth. */
export function Wheel({
  items,
  value,
  onChange,
  width,
  label,
}: {
  items: ReadonlyArray<{ value: number; label: string }>
  value: number
  onChange: (v: number) => void
  width: number
  label: string
}) {
  const theme = useTheme()
  const scrollRef = useRef<ScrollView>(null)
  const lastEmitted = useRef<number | null>(null)
  const didInit = useRef(false)

  const index = Math.max(0, items.findIndex((i) => i.value === value))

  // Same rule as the ruler: set the offset once, then let the scroll view own it.
  // A controlled `contentOffset` reasserts the old position on every scroll frame,
  // which is what makes a wheel feel sticky or refuse to move at all.
  const onLayout = useCallback(() => {
    if (didInit.current) return
    didInit.current = true
    scrollRef.current?.scrollTo({ y: index * ROW_HEIGHT, animated: false })
  }, [index])

  // External changes only — e.g. the day wheel being clamped when the month
  // changes from March to February.
  useEffect(() => {
    if (!didInit.current) return
    if (lastEmitted.current === value) return
    scrollRef.current?.scrollTo({ y: index * ROW_HEIGHT, animated: false })
  }, [index, value])

  return (
    <ScrollView
      ref={scrollRef}
      onLayout={onLayout}
      accessibilityLabel={label}
      showsVerticalScrollIndicator={false}
      snapToInterval={ROW_HEIGHT}
      disableIntervalMomentum
      decelerationRate="fast"
      scrollEventThrottle={16}
      contentContainerStyle={{ paddingVertical: ROW_HEIGHT * 2 }}
      onScroll={(e) => {
        const i = Math.round(e.nativeEvent.contentOffset.y / ROW_HEIGHT)
        const next = items[Math.min(items.length - 1, Math.max(0, i))]
        if (next && next.value !== value) {
          lastEmitted.current = next.value
          void Haptics.selectionAsync()
          onChange(next.value)
        }
      }}
      style={{ width, height: ROW_HEIGHT * 5 }}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <View key={item.value} style={{ height: ROW_HEIGHT, justifyContent: 'center', alignItems: 'center' }}>
            <Text
              style={{
                fontSize: active ? 24 : 22,
                fontWeight: active ? '700' : '400',
                color: active ? theme.text : theme.textFaint,
              }}
            >
              {item.label}
            </Text>
          </View>
        )
      })}
    </ScrollView>
  )
}

/** The selection band drawn behind a row of wheels. */
export function WheelHighlight({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ height: ROW_HEIGHT * 5, justifyContent: 'center' }}>
      <View
        pointerEvents="none"
        style={[
          styles.wheelBand,
          { backgroundColor: theme.isDark ? theme.bgSunken : '#F2F2F5' },
        ]}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>{children}</View>
    </View>
  )
}

export const WHEEL_ROW_HEIGHT = ROW_HEIGHT

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    marginBottom: space.md,
    minHeight: 84,
  },
  glyphCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: { fontSize: 18, fontWeight: '700' },
  radioOuter: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 14, height: 14, borderRadius: radius.pill },
  segmentWrap: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: 4,
    alignSelf: 'center',
  },
  segment: {
    paddingHorizontal: space.xxl,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 112,
  },
  segmentActive: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  editRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space.xs },
  readoutValue: { fontSize: 44, fontWeight: '800', letterSpacing: -1.2 },
  readoutUnit: { fontSize: 44, fontWeight: '800', letterSpacing: -1.2 },
  editInput: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.2,
    minWidth: 130,
    textAlign: 'right',
    borderBottomWidth: 2,
    paddingBottom: 2,
  },
  rulerCursor: { position: 'absolute', top: 0, alignItems: 'center' },
  wheelBand: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    height: ROW_HEIGHT + 8,
    borderRadius: radius.lg,
  },
})
