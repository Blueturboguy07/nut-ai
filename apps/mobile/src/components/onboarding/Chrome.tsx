import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../Icon'
import { useTheme } from '../../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../theme/tokens'

/**
 * Shared onboarding chrome: back chevron, progress bar, title, subtitle, and the
 * docked bottom action.
 *
 * Every screen in the flow uses this, which is what makes the flow feel like one
 * thing rather than twenty. The measurements: a 44pt circular back button on a very light fill, a 6pt pill
 * progress track, a ~40pt bold title with tight tracking, and a full-width pill
 * button docked above the home indicator.
 */

export function ProgressBar({ step, total }: { step: number; total: number }) {
  const theme = useTheme()
  const pct = Math.max(0.02, Math.min(1, step / total))
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: step }}
      style={[styles.track, { backgroundColor: theme.isDark ? theme.border : '#EDEDF0' }]}
    >
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: theme.text }]} />
    </View>
  )
}

export function OnboardingHeader({ step, total }: { step: number; total: number }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        hitSlop={space.sm}
        style={[styles.back, { backgroundColor: theme.isDark ? theme.bgElevated : '#F3F3F6' }]}
      >
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Icon name="chevron" size={19} color={theme.text} weight={2.2} />
        </View>
      </Pressable>
      <View style={{ flex: 1, marginLeft: space.lg, marginRight: space.xs }}>
        <ProgressBar step={step} total={total} />
      </View>
    </View>
  )
}

export interface OnboardingScreenProps {
  step: number
  total: number
  title: string
  subtitle?: string
  children?: ReactNode
  /** Primary action label. */
  cta?: string
  onCta: () => void
  ctaDisabled?: boolean
  /** Secondary action beneath the primary, e.g. Skip or No. */
  secondaryLabel?: string
  onSecondary?: () => void
  /** Content sits in a ScrollView when it can overflow. */
  scroll?: boolean
  /** Center the content block vertically, as the picker screens do. */
  centerContent?: boolean
}

export function OnboardingScreen({
  step,
  total,
  title,
  subtitle,
  children,
  cta = 'Continue',
  onCta,
  ctaDisabled = false,
  secondaryLabel,
  onSecondary,
  scroll = false,
  centerContent = false,
}: OnboardingScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const body = (
    <>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text>
      ) : null}
      <View style={[styles.content, centerContent && { flex: 1, justifyContent: 'center' }]}>
        {children}
      </View>
    </>
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <OnboardingHeader step={step} total={total} />

      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 180 }}
          showsVerticalScrollIndicator={false}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.lg }}>{body}</View>
      )}

      <View
        style={[
          styles.actions,
          {
            paddingBottom: Math.max(insets.bottom, space.lg),
            backgroundColor: theme.bg,
            borderTopColor: theme.border,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: ctaDisabled }}
          disabled={ctaDisabled}
          onPress={onCta}
          style={[
            styles.primary,
            { backgroundColor: ctaDisabled ? (theme.isDark ? theme.border : '#B7B7BD') : theme.text },
          ]}
        >
          <Text style={[type.bodyStrong, { color: ctaDisabled ? '#FFFFFF' : theme.bg, fontSize: 18 }]}>
            {cta}
          </Text>
        </Pressable>

        {secondaryLabel ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSecondary}
            hitSlop={space.sm}
            style={styles.secondary}
          >
            <Text style={[type.bodyStrong, { color: theme.text, fontSize: 17 }]}>
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  back: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
  title: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -1.1,
    marginTop: space.xs,
  },
  subtitle: { fontSize: 17, lineHeight: 24, marginTop: space.md },
  content: { marginTop: space.xl },
  actions: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
