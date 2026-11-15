import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import { space, tap, type } from '../theme/tokens'

/**
 * A "Done" bar above the iOS number pad, which has no return key.
 *
 * Blind test round 1, Nov 14 2026 (B10): in Log exercise → Manual the number
 * pad covered "Add Exercise" and could not be closed. Give each number field
 * `inputAccessoryViewID={KEYBOARD_DONE_ID}` and render <KeyboardDoneBar /> once
 * on the screen. Android number pads have their own Done key: nothing there.
 */
export const KEYBOARD_DONE_ID = 'keyboard-done'

export function KeyboardDoneBar() {
  const theme = useTheme()
  if (Platform.OS !== 'ios') return null
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={[styles.bar, { backgroundColor: theme.bgSunken, borderTopColor: theme.border }]}>
        <Pressable accessibilityRole="button" onPress={() => Keyboard.dismiss()} style={[tap, styles.done]}>
          <Text style={[type.bodyStrong, { color: theme.protein }]}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth },
  done: { paddingHorizontal: space.lg, alignItems: 'center' },
})
