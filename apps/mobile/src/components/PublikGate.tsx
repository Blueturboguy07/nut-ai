import { SplashScreen } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PUBLIK_GATE_MODE } from '../build-flags'
import { birthYearOnFile, putSetting, setting } from '../data/repo'
import { closePublikLink, onPublikSignOut, openPublikLink, runPublikGate, setPublikPlanAllowedCheck } from '../inference/publik'
import type { Choice, GateAction, GateScreen, GateUI } from '../inference/publik-core'
import { isAdult } from '../onboarding/adult'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'

/**
 * Sign in with publik, before any screen of the app (required mode, the
 * default build), or no wall at all (optional mode: app/publik-sign-in.tsx
 * asks when the person picks publik API or taps Sign in with publik).
 *
 * The gate itself (which screen, when, and the words) is the publik module in
 * src/inference/publik-core.ts; this file only draws its screens and hands
 * back the button pressed. In required mode nothing of the app renders until
 * the gate resolves: no tab, no onboarding, no database read. A sign-out
 * (Profile, or Start over) runs the gate again.
 *
 * expo-router hides the splash screen when its first navigator mounts, and
 * the gate renders no navigator, so the gate hides the splash itself when it
 * shows a screen (and after 4 seconds at most).
 */

// The plan screen only for an adult: the age from onboarding; unknown = no.
setPublikPlanAllowedCheck(async () => isAdult({ birthYear: await birthYearOnFile() }, Date.now()))

export interface Shown {
  screen: GateScreen
  /** A button was pressed, or the gate moved on: the buttons wait for the next screen. */
  busy: boolean
  press: (action: GateAction) => void
}

/**
 * The GateUI of a mounted screen. `dispose()` on unmount ends the gate's
 * current screen, so its 3 s check stops with the screen.
 */
export function gateUI(setShown: (f: (s: Shown | null) => Shown | null) => void): { ui: GateUI; dispose: () => void } {
  let alive = true
  let cancel: (() => void) | null = null
  const settle = (screen: GateScreen) => setShown((s) => (s && s.screen === screen ? { ...s, busy: true } : s))
  const ui: GateUI = {
    show: (screen, signal) =>
      new Promise<GateAction>((resolve, reject) => {
        if (!alive) return reject(new Error('closed'))
        void SplashScreen.hideAsync().catch(() => undefined)
        cancel = () => reject(new Error('closed'))
        signal.addEventListener('abort', () => settle(screen))
        setShown(() => ({
          screen,
          busy: false,
          press: (action) => {
            settle(screen)
            resolve(action)
          },
        }))
      }),
    openUrl: (url) => void openPublikLink(url),
    closeBrowser: () => closePublikLink(),
  }
  return {
    ui,
    dispose: () => {
      alive = false
      cancel?.()
    },
  }
}

/**
 * The plan choice, in the app's own provider setting (the resolver reads that
 * one). Connect your plan: scans run on publik API. Use my own key: a phone
 * that was on publik API waits for a key (Profile → AI provider, or the
 * onboarding key step). A key the person already saved stays as it is.
 */
export async function applyChoice(choice: Choice): Promise<void> {
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
        // Optional mode has no wall: after a sign-out the app stays open.
        if (PUBLIK_GATE_MODE === 'optional') return
        setPassed(false)
        setShown(null)
        setRound((n) => n + 1)
      }),
    [],
  )

  useEffect(() => {
    let alive = true
    const splash = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), 4_000)
    const { ui, dispose } = gateUI(setShown)
    runPublikGate(ui)
      .then(async (gate) => {
        if (gate?.chosen && gate.choice) await applyChoice(gate.choice).catch(() => undefined)
        if (!alive) return
        setShown(null)
        setPassed(true)
      })
      .catch(() => {
        // The screen closed, or something the gate did not expect: start it again.
        setTimeout(() => {
          if (alive) setRound((n) => n + 1)
        }, 1_000)
      })
    return () => {
      alive = false
      clearTimeout(splash)
      dispose()
    }
  }, [round])

  if (passed) return <>{children}</>
  return <GateView shown={shown} />
}

export function GateView({ shown, onClose }: { shown: Shown | null; onClose?: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const s = shown?.screen

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {onClose ? (
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={space.md}
          style={[styles.close, { top: insets.top + space.sm }]}
        >
          <Text style={[type.label, { color: theme.textMuted }]}>Not now</Text>
        </Pressable>
      ) : null}
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
            {s.id === 'sign_in' ? (
              <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xl, lineHeight: 18 }]}>
                publik counts when this app opens. You can turn this off in Profile → publik account.
              </Text>
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
  close: { position: 'absolute', right: space.lg, zIndex: 2 },
})
