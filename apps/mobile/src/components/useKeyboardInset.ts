import { useEffect, useState } from 'react'
import { Keyboard, Platform, type KeyboardEvent } from 'react-native'

/**
 * The height of the iOS keyboard (with its accessory bar) while it is open;
 * 0 when it is closed and always 0 on Android, where the window itself
 * resizes for the keyboard.
 *
 * Blind test round 2 (Nov 15 2026, N8): the keyboard covered "Estimate" and
 * "Verify and save". KeyboardAvoidingView measures the wrong offset in a
 * modal sheet, so a screen with a bottom button bar moves the bar up by this
 * height instead: `bottom: keyboardInset`.
 */
export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const show = Keyboard.addListener('keyboardWillShow', (e: KeyboardEvent) => setHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener('keyboardWillHide', () => setHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}
