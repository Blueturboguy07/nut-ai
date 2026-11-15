import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MAX_MEAL_DESCRIPTION_CHARS } from '@nutai/prompt'
import { Icon } from '../src/components/Icon'
import { StatusBarScrim } from '../src/components/StatusBarScrim'
import { startDescribedMeal } from '../src/scan/orchestrator'
import { setPhase } from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, tap, type } from '../src/theme/tokens'

/**
 * Describe a meal: the meal in the person's own words, to an AI estimate.
 *
 * Blind test round 1 (Nov 14 2026): with no usable camera (a simulator, a
 * broken camera, App Review) nothing could be estimated. The text goes to the
 * AI provider the person chose (the AI consent question asks first), through
 * the same pipeline as a photo, and the same review screen shows every row,
 * labeled AI ESTIMATE where it is one, to correct before it is logged.
 *
 * Without an AI provider the Food Database (on the phone, no network) is the
 * way to log a meal; the link below goes there.
 */
export default function DescribeMeal() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const ready = text.trim().length > 0

  function estimate() {
    const description = text.trim()
    if (!description) return
    setPhase({ kind: 'analyzing', photoUri: '', stage: 'identifying' })
    router.replace('/result')
    void startDescribedMeal(description)
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: space.xl }}
      >
        <View style={styles.head}>
          <Text style={[type.title, { color: theme.text, flex: 1 }]}>Describe a meal</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={tap}>
            <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
          </Pressable>
        </View>

        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          Write what you ate and how much. You get an AI estimate, and you can correct every row
          before you log it.
        </Text>

        <TextInput
          autoFocus
          multiline
          accessibilityLabel="What you ate"
          placeholder="What did you eat?"
          placeholderTextColor={theme.textFaint}
          maxLength={MAX_MEAL_DESCRIPTION_CHARS}
          value={text}
          onChangeText={setText}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />

        <View style={[styles.example, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
            <Text style={{ fontWeight: '700', color: theme.text }}>Example:</Text> 2 scrambled eggs, 1 slice
            of whole wheat toast with butter, a black coffee
          </Text>
        </View>

        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          The text goes to your AI provider (Profile → AI provider), which estimates the food. It
          is an estimate, not a measurement.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/food-search' as never)}
          style={[tap, { marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: space.xs }]}
        >
          <Icon name="search" size={16} color={theme.protein} />
          <Text style={[type.label, { color: theme.protein }]}>No AI provider? Search the food database</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), borderTopColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          onPress={estimate}
          style={[styles.cta, { backgroundColor: ready ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Estimate</Text>
        </Pressable>
      </View>
      <StatusBarScrim />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: {
    marginTop: space.lg,
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 120,
    fontSize: 17,
    textAlignVertical: 'top',
  },
  example: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  dock: { padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  cta: { minHeight: Math.max(MIN_TAP_TARGET, 56), borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
