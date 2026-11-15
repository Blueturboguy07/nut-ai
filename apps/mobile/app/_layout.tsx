import { Stack, router, useRootNavigationState, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import Storage from 'expo-sqlite/kv-store'
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LaunchCover } from '../src/components/LaunchScreen'
import { PublikGate } from '../src/components/PublikGate'
import { foodDbSelfTest } from '../src/data/food-search'
import { openNutritionDb } from '../src/db/expo-adapter'
import { aiConsentCopy, setAiConsentPrompter } from '../src/inference/ai-consent'
import { ensurePublikWallet, publikAiProviders, setPublikSelfTestExtra } from '../src/inference/publik'
import { APP_NAME } from '../src/inference/publik-copy'
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider'

import { ONBOARDING_DONE_KEY } from '../src/onboarding/done-key'
export { ONBOARDING_DONE_KEY }

// The question before anything goes to an AI provider the first time
// (src/inference/ai-consent.ts). It names the provider, and on the publik
// path publik's own list of companies (GET /wallet `ai_providers`, read now);
// "Not now" sends nothing.
setAiConsentPrompter(
  async (destination) => {
    const providers = destination === 'publik' ? await publikAiProviders().catch(() => null) : null
    return new Promise<boolean>((resolve) => {
      const c = aiConsentCopy(destination, APP_NAME, providers)
      Alert.alert(
        c.title,
        c.body,
        [
          { text: c.decline, style: 'cancel', onPress: () => resolve(false) },
          { text: c.agree, onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      )
    })
  },
)

// The CI self-test (test builds only, PUBLIK_SELF_TEST) also proves that
// the bundled food database loads and that a search for "egg" finds food
// (blind test round 1, Nov 14 2026, B2). Its line follows the publik line.
setPublikSelfTestExtra(async () => foodDbSelfTest(await openNutritionDb()))

/**
 * The entry gates, in order.
 *
 * 1. Sign in with publik (PublikGate, the publik module): in the default
 *    (required) build, before any screen of the app, also onboarding; Root
 *    below does not render until the person is signed in. In an optional
 *    build there is no wall (app/publik-sign-in.tsx asks when needed).
 * 2. Onboarding runs once. The flag is written when the plan screen is dismissed,
 * and lives in the same SQLite-backed store as everything else rather than
 * introducing a second storage mechanism — one place for local state is one place
 * to export, wipe, and reason about.
 */
function useOnboardingGate() {
  const navState = useRootNavigationState()
  const segments = useSegments()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // Navigating before the root navigator has mounted throws.
    if (!navState?.key || checked) return
    let alive = true
    void (async () => {
      const done = await Storage.getItem(ONBOARDING_DONE_KEY)
      if (!alive) return
      setChecked(true)
      const inOnboarding = segments[0] === 'onboarding'
      if (done !== 'true' && !inOnboarding) {
        router.replace('/onboarding')
      }
    })()
    return () => {
      alive = false
    }
  }, [navState?.key, segments, checked])
}

function Root() {
  const theme = useTheme()
  useOnboardingGate()

  // A reinstall keeps the publik key (Keychain) but not the app's storage:
  // keep the sign-in, and read the plan again, so every screen shows one
  // truth (blind test round 1, B11). Nothing happens when a wallet is stored.
  useEffect(() => {
    void ensurePublikWallet().catch(() => null)
  }, [])

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        {/* Full-screen flows are native modals: swipe-to-dismiss on iOS. */}
        <Stack.Screen name="camera" options={{ presentation: 'modal' }} />
        <Stack.Screen name="result" options={{ presentation: 'modal' }} />
        <Stack.Screen name="log-weight" options={{ presentation: 'modal' }} />
        <Stack.Screen name="provider-settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="publik-sign-in" options={{ presentation: 'modal' }} />
        <Stack.Screen name="log-exercise" options={{ presentation: 'modal' }} />
        <Stack.Screen name="food-search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="saved-foods" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-goals" options={{ presentation: 'modal' }} />
        <Stack.Screen name="report-result" options={{ presentation: 'modal' }} />
        <Stack.Screen name="how-estimates-work" options={{ presentation: 'modal' }} />
        <Stack.Screen name="describe-meal" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PublikGate>
            <Root />
          </PublikGate>
          {/* The launch screen until the first screen is ready (blind test round 2, N9). */}
          <LaunchCover />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
