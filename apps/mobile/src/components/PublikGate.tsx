import { SplashScreen } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { putSetting, setting } from '../data/repo'
import { onPublikSignOut, openPublikLink, runPublikGate } from '../inference/publik'
import type { Choice, GateAction, GateScreen, GateUI } from '../inference/publik-core'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'

/**
 * Sign in with publik, before any screen of the app.
 *
 * The gate itself (which screen, when, and the words) is the publik module in
 * src/inference/publik-core.ts; this component only draws its screens and
 * hands back the button pressed. Nothing of the app renders until the gate
 * resolves: no tab, no onboarding, no database read. A sign-out (Profile →
 * AI provider, or Start over) runs the gate again.
 *
 * expo-router hides the splash screen when its first navigator mounts, and
 * the gate renders no navigator, so the gate hides the splash itself when it
 * shows a screen (and after 4 seconds at most).
 */

interface Shown {
  screen: GateScreen
  /** A button was pressed, or the gate moved on: the buttons wait for the next screen. */
  busy: boolean
  press: (action: GateAction) => void
}

/**
 * The plan choice, in the app's own provider setting (the resolver reads that
 * one). Connect your plan: scans run on publik API. Use my own key: a phone
 * that was on publik API waits for a key (Profile → AI provider, or the
 * onboarding key step). A key the person already saved stays as it is.
 */
async function applyChoice(choice: Choice): Promise<void> {
  const provider = await setting('provider')
  if (choice === 'publik') {
    if (provider !== 'publik') {
      await putSetting('provider', 'publik')
      await putSetting('provider_model', '')
    }
    return
  }
  if (provider === 'publik') await putSetting('provider', 'none')
}

export function PublikGate({ children }: { children: ReactNode }) {
  const [round, setRound] = useState(0)
  const [passed, setPassed] = useState(false)
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(
    () =>
      onPublikSignOut(() => {
        setPassed(false)
        setShown(null)
        setRound((n) => n + 1)
      }),
    [],
  )

  useEffect(() => {
    let alive = true
    const splash = setTimeout(() => void SplashScreen.hideAsync(), 4_000)
    const settle = (screen: GateScreen) => setShown((s) => (s && s.screen === screen ? { ...s, busy: true } : s))
    const ui: GateUI = {
      show: (screen, signal) =>
        new Promise<GateAction>((resolve) => {
          if (!alive) return
          void SplashScreen.hideAsync()
          signal.addEventListener('abort', () => settle(screen))
          setShown({
            screen,
            busy: false,
            press: (action) => {
              settle(screen)
              resolve(action)
            },
          })
        }),
      openUrl: (url) => openPublikLink(url),
    }
    runPublikGate(ui)
      .then(async (gate) => {
        if (gate.chosen && gate.choice) await applyChoice(gate.choice).catch(() => undefined)
        if (!alive) return
        setShown(null)
        setPassed(true)
      })
      .catch(() => {
        // A store the gate could not read: start the gate again.
        setTimeout(() => {
          if (alive) setRound((n) => n + 1)
        }, 1_000)
      })
    return () => {
      alive = false
      clearTimeout(splash)
    }
  }, [round])

  if (passed) return <>{children}</>
  return <GateView shown={shown} />
}

function GateView({ shown }: { shown: Shown | null }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const s = shown?.screen

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {shown && s ? (
        <>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: insets.top + space.xxxl, paddingBottom: space.xl }}
            showsVerticalScrollIndicator={false}
          >
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              {s.title}
            </Text>
            <Text style={[styles.body, { color: theme.textMuted }]}>{s.body}</Text>
            {s.note ? (
              <View style={[styles.note, { backgroundColor: theme.bgSunken }]}>
                <Text style={[type.label, { color: theme.text, lineHeight: 20 }]}>{s.note}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={[
              styles.actions,
              { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg, borderTopColor: theme.border },
            ]}
          >
            {s.buttons.map((b, i) =>
              i === 0 ? (
                <Pressable
                  key={b.action}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: shown.busy }}
                  disabled={shown.busy}
                  onPress={() => shown.press(b.action)}
                  style={[styles.primary, { backgroundColor: theme.text, opacity: shown.busy ? 0.5 : 1 }]}
                >
                  <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>{b.label}</Text>
                </Pressable>
              ) : (
                <Pressable
                  key={b.action}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: shown.busy }}
                  disabled={shown.busy}
                  onPress={() => shown.press(b.action)}
                  hitSlop={space.sm}
                  style={[styles.secondary, { opacity: shown.busy ? 0.5 : 1 }]}
                >
                  <Text style={[type.bodyStrong, { color: theme.text, fontSize: 17 }]}>{b.label}</Text>
                </Pressable>
              ),
            )}
          </View>
        </>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textMuted} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 36, lineHeight: 42, fontWeight: '800', letterSpacing: -1.1 },
  body: { fontSize: 17, lineHeight: 24, marginTop: space.md },
  note: { marginTop: space.xl, padding: space.lg, borderRadius: radius.lg },
  actions: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  primary: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  secondary: { height: 52, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
