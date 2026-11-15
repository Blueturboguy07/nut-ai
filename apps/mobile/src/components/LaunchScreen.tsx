import { useEffect, useRef, useState } from 'react'
import { Animated, Image, StyleSheet, View } from 'react-native'

/**
 * The launch screen, in React: the same picture as the native launch screen
 * (plugins/withLaunchScreen.js), the app mark on the icon's near-black.
 *
 * Blind test round 2 (Nov 15 2026, N9): a cold start showed a plain white
 * screen for 6-9 s, while the publik sign-in check and the first data load
 * ran. <LaunchCover /> (app/_layout.tsx) now lies over the app from the first
 * frame until the first screen says it is ready (markFirstScreenReady: Home
 * after its first data load, the first onboarding screen, the sign-in
 * screen), then fades out. It never stays longer than 12 s.
 */
export const LAUNCH_BACKGROUND = '#0B0B0F'
const MAX_COVER_MS = 12_000

let ready = false
const listeners = new Set<() => void>()

/** The first screen has its content: the cover fades out. Idempotent. */
export function markFirstScreenReady(): void {
  if (ready) return
  ready = true
  for (const l of [...listeners]) l()
}

export function LaunchScreen() {
  return (
    <View style={styles.full} accessibilityLabel="publik Nut AI is starting">
      <Image source={require('../../assets/launch-mark.png')} style={styles.mark} />
    </View>
  )
}

export function LaunchCover() {
  const [done, setDone] = useState(ready)
  const [gone, setGone] = useState(ready)
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const finish = () => setDone(true)
    listeners.add(finish)
    const cap = setTimeout(finish, MAX_COVER_MS)
    return () => {
      listeners.delete(finish)
      clearTimeout(cap)
    }
  }, [])

  useEffect(() => {
    if (!done) return
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setGone(true))
  }, [done, opacity])

  if (gone) return null
  return (
    <Animated.View pointerEvents={done ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, { opacity }]}>
      <LaunchScreen />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: LAUNCH_BACKGROUND, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 120, height: 120 },
})
