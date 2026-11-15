import { Stack, router, useRootNavigationState, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import Storage from 'expo-sqlite/kv-store'
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { PublikGate } from '../src/components/PublikGate'
import { aiConsentCopy, setAiConsentPrompter } from '../src/inference/ai-consent'
import { APP_NAME } from '../src/inference/publik-copy'
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider'

import { ONBOARDING_DONE_KEY } from '../src/onboarding/done-key'
export { ONBOARDING_DONE_KEY }

// The question before anything goes to an AI provider the first time
// (src/inference/ai-consent.ts). It names the provider; "Not now" sends nothing.
setAiConsentPrompter(
  (destination) =>
    new Promise<boolean>((resolve) => {
      const c = aiConsentCopy(destination, APP_NAME)
      Alert.alert(
        c.title,
        c.body,
        [
          { text: c.decline, style: 'cancel', onPress: () => resolve(false) },
          { text: c.agree, onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      )
    }),
)

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
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
