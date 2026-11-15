import { Tabs, router } from 'expo-router'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../../src/components/Icon'
import { startScan } from '../../src/scan/orchestrator'
import { pickMealPhoto } from '../../src/scan/pick-photo'
import { setPhase } from '../../src/scan/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'

/**
 * Three tabs plus the detached FAB.
 *
 * GROUPS IS GONE. A social feed cannot be local-first without a server we
 * operate, it needs Apple 1.2 moderation machinery before it can ship at all,
 * and it is the highest eating-disorder-risk surface in this product category.
 * Cutting it is the decision, not a gap.
 *
 * The FAB is ALWAYS present and ALWAYS opens real logging. A paywall on this
 * button would block the one thing the app is for, so there is none. No IAP is
 * configured anywhere in this project.
 */

const TABS: ReadonlyArray<{ name: string; label: string; icon: IconName }> = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'progress', label: 'Progress', icon: 'chart' },
  { name: 'profile', label: 'Profile', icon: 'person' },
]

interface Action {
  label: string
  icon: IconName
  route: string
}

// "Describe a meal" and "Choose a photo" need no camera (blind test round 1,
// Nov 14 2026): a simulator, a phone whose camera cannot be used, App Review.
const ACTIONS: Action[] = [
  { label: 'Log exercise', icon: 'dumbbell', route: '/log-exercise' },
  { label: 'Saved foods', icon: 'bookmark', route: '/saved-foods' },
  { label: 'Food Database', icon: 'search', route: '/food-search' },
  { label: 'Describe a meal', icon: 'pencil', route: '/describe-meal' },
  { label: 'Choose a photo', icon: 'image', route: 'pick-photo' },
  { label: 'Scan food', icon: 'scan', route: '/camera' },
]

/** Longer than the menu's fade-out, so the picker opens on the tab screen. */
const PICKER_DELAY_MS = 450

/** "Choose a photo": a meal photo from the library, through the same scan as a camera photo. */
async function choosePhoto(): Promise<void> {
  const uri = await pickMealPhoto().catch(() => null)
  if (!uri) return
  setPhase({ kind: 'captured', photoUri: uri })
  router.push('/result')
  void startScan(uri)
}

export default function TabLayout() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg } }}
        tabBar={({ state, navigation }) => (
          // An opaque band with a hairline on top (blind test round 2, N10):
          // content scrolled under the bar showed between the pill and the
          // + button, as a stray dark mark, and "Sign out" sat behind it.
          <View
            style={[
              styles.wrap,
              { paddingBottom: Math.max(insets.bottom, space.md), backgroundColor: theme.bg, borderTopColor: theme.border },
            ]}
          >
            <View style={[styles.pill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
              {TABS.map((tab, i) => {
                const focused = state.index === i
                return (
                  <Pressable
                    key={tab.name}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: focused }}
                    accessibilityLabel={tab.label}
                    onPress={() => navigation.navigate(tab.name)}
                    style={[styles.tab, focused && { backgroundColor: theme.bgSunken }]}
                    hitSlop={space.sm}
                  >
                    <Icon name={tab.icon} size={21} color={focused ? theme.text : theme.textFaint} />
                    <Text style={[type.micro, { color: focused ? theme.text : theme.textFaint, marginTop: 1 }]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add"
              onPress={() => setSheetOpen(true)}
              style={[styles.fab, { backgroundColor: theme.text }]}
            >
              <Icon name="plus" size={26} color={theme.bg} weight={2.2} />
            </Pressable>
          </View>
        )}
      >
        {TABS.map((t) => (
          <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
        ))}
      </Tabs>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <View style={[styles.grid, { paddingBottom: Math.max(insets.bottom, space.md) + 90 }]}>
            {ACTIONS.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                onPress={() => {
                  setSheetOpen(false)
                  // The photo picker opens after this menu has faded out: iOS
                  // does not present it over a sheet that is closing.
                  if (a.route === 'pick-photo') setTimeout(() => void choosePhoto(), PICKER_DELAY_MS)
                  else router.push(a.route as never)
                }}
                style={[styles.action, { backgroundColor: theme.bgElevated }]}
              >
                <Icon name={a.icon} size={28} color={theme.text} />
                <Text style={[type.bodyStrong, { color: theme.text, marginTop: space.sm }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.closeWrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setSheetOpen(false)}
              style={[styles.fab, { backgroundColor: theme.text }]}
            >
              <Icon name="close" size={22} color={theme.bg} weight={2.2} />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.pill,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  action: {
    width: '47%',
    aspectRatio: 1.6,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    paddingHorizontal: space.lg,
  },
})
