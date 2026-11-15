import { Stack } from 'expo-router'
import { useEffect } from 'react'
import { markFirstScreenReady } from '../../src/components/LaunchScreen'
import { useTheme } from '../../src/theme/ThemeProvider'

export default function OnboardingLayout() {
  const theme = useTheme()
  // Onboarding is the first screen of a new install: the launch cover goes (N9).
  useEffect(() => markFirstScreenReady(), [])
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        // Native push transitions and the iOS back-swipe, for free.
        animation: 'slide_from_right',
        gestureEnabled: true,
      }}
    />
  )
}
