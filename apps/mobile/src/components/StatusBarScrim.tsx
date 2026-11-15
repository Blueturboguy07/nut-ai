import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeProvider'

/**
 * A band of the screen's background over the status bar (the clock and the
 * Dynamic Island), so that text scrolled up does not run under them. Blind
 * test round 1, Nov 14 2026 (B8). Put it LAST inside a screen's root View,
 * after the ScrollView. It takes no touches. Where the screen has no top
 * inset (a sheet below the status bar), it draws nothing.
 */
export function StatusBarScrim() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  if (insets.top <= 0) return null
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: theme.bg }}
    />
  )
}
