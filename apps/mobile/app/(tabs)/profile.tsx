import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Linking } from 'react-native'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ProviderId } from '@nutai/prompt'
import { availability, requestPermissions } from '../../src/health/healthkit'
import { exportAndShareBackup, finishRestore, importBackup, pickBackupFile } from '../../src/data/backup'
import { currentGoal, resetEverything, setting, type CurrentGoal } from '../../src/data/repo'
import { loadCredential, maskCredential } from '../../src/inference/credentials'
import { loadPublikWallet, publikConnected } from '../../src/inference/publik'
import { formatMicros } from '../../src/inference/publik-core'
import { PROVIDER_NAME } from '../../src/components/CredentialForm'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Profile.
 *
 * Structurally the reference's settings list, minus everything that only exists
 * to extract money or attention:
 *
 *   NO "Refer a friend and earn $10" — a referral bounty is a growth mechanic,
 *   and there is no money here to pay it with.
 *   NO "Upgrade to Family Plan", no Premium crown. There is no paid tier.
 *   NO Logout / Delete Account. There is no account and no server; a delete
 *     button that only clears local data should say exactly that, which is what
 *     "Erase all data" below does.
 *   NO Follow Us. A settings screen is not a marketing surface.
 */
export default function Profile() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [healthAvail, setHealthAvail] = useState<'available' | 'not-ios' | 'unavailable' | 'checking'>('checking')
  const [healthBusy, setHealthBusy] = useState(false)
  const [diet, setDiet] = useState('')
  const [providerLabel, setProviderLabel] = useState('—')
  const [dataBusy, setDataBusy] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        const [g, avail, d, p] = await Promise.all([
          currentGoal(),
          availability(),
          setting('diet.style', 'balanced'),
          setting('provider'),
        ])
        if (!alive) return
        setGoal(g)
        setDiet(d)
        setHealthAvail(avail === 'available' ? 'available' : avail === 'not-ios' ? 'not-ios' : 'unavailable')
        if (!p || p === 'none') {
          setProviderLabel('Not connected')
        } else if (p === 'publik') {
          const [connected, wallet] = await Promise.all([publikConnected(), loadPublikWallet()])
          if (!alive) return
          setProviderLabel(connected ? `publik API · ${formatMicros(wallet?.balanceMicros)} left` : 'publik API · disconnected')
        } else {
          const cred = await loadCredential(p as ProviderId)
          if (!alive) return
          setProviderLabel(
            cred
              ? `${PROVIDER_NAME[p as ProviderId]} · ${maskCredential(cred.value)}`
              : `${PROVIDER_NAME[p as ProviderId]} · key missing`,
          )
        }
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  function connectHealth() {
    if (healthBusy) return
    setHealthBusy(true)
    void (async () => {
      const res = await requestPermissions()
      setHealthBusy(false)
      // iOS never reports whether READ access was granted — claiming success
      // here would be a lie. Say what actually happened and point at Settings.
      if (res.prompted) {
        Alert.alert('Done', 'If you allowed access, steps and workouts will appear as they sync.')
      } else {
        Alert.alert(
          'Health did not respond',
          'Manage access under Settings → Privacy & Security → Health, or from the button below.',
        )
      }
    })()
  }

  function exportData() {
    if (dataBusy) return
    setDataBusy(true)
    void (async () => {
      try {
        const res = await exportAndShareBackup()
        if (!res.shared) Alert.alert('Exported', `Saved to ${res.name}. Sharing is unavailable on this device.`)
      } catch {
        Alert.alert('Export failed', 'Could not write the backup file. Try again.')
      } finally {
        setDataBusy(false)
      }
    })()
  }

  function importData() {
    if (dataBusy) return
    void (async () => {
      const picked = await pickBackupFile()
      if (!picked.ok) {
        if (picked.reason !== 'cancelled') {
          Alert.alert('Not a backup', "That doesn't look like a Nut AI backup file.")
        }
        return
      }
      Alert.alert(
        'Restore this backup?',
        'This replaces ALL data currently on this device and cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => {
              setDataBusy(true)
              void (async () => {
                try {
                  const outcome = await importBackup(picked.payload)
                  if (!outcome.ok) {
                    Alert.alert('Cannot restore', 'This backup is from a newer version of Nut AI — update the app first.')
                    return
                  }
                  await finishRestore()
                  router.replace('/(tabs)' as never)
                } catch (e) {
                  // A restore that fails must SAY SO — the transaction rolled
                  // back, nothing was lost, and silence here cost us a real
                  // debugging session once already.
                  Alert.alert('Restore failed', `Nothing was changed. ${String((e as Error)?.message ?? e)}`)
                } finally {
                  setDataBusy(false)
                }
              })()
            },
          },
        ],
      )
    })()
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.title, { color: theme.text }]}>Profile</Text>

      <View style={[styles.hero, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>No account needed</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          Everything lives on this device. There is no sign-in, no server, and nothing to breach.
        </Text>
      </View>

      <Section title="Goals & tracking">
        <Row
          label="Daily target"
          value={goal ? `${Math.round(goal.targetKcal)} kcal` : '—'}
          onPress={() => router.push('/edit-goals' as never)}
        />
        <Row
          label="Protein / Carbs / Fat"
          value={goal ? `${Math.round(goal.protein_g)} / ${Math.round(goal.carbs_g)} / ${Math.round(goal.fat_g)} g` : '—'}
          onPress={() => router.push('/edit-goals' as never)}
        />
        <Row label="Log weight" value="" onPress={() => router.push('/log-weight' as never)} />
        <Row label="Diet style" value={diet} />
        <Row
          label="Adaptive target"
          value={goal ? (goal.adaptive ? 'On' : 'Off — set by hand') : '—'}
        />
      </Section>

      <Section title="AI provider">
        <Row label="Provider & key" value={providerLabel} onPress={() => router.push('/provider-settings' as never)} />
      </Section>

      <Section title="Apple Health">
        {healthAvail === 'available' ? (
          <>
            <Row
              label={healthBusy ? 'Connecting…' : 'Connect / Reconnect'}
              value=""
              onPress={connectHealth}
            />
            <Pressable onPress={() => void Linking.openSettings()} style={{ padding: space.lg, paddingTop: 0 }}>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                Already answered the prompt? <Text style={{ color: theme.protein }}>Manage access in Settings</Text>
              </Text>
            </Pressable>
          </>
        ) : (
          <Row label="Apple Health" value={healthAvail === 'not-ios' ? 'iOS only' : 'Unavailable on this device'} />
        )}
      </Section>

      <Section title="Your data">
        <Row label={dataBusy ? 'Working…' : 'Export data'} value="" onPress={exportData} />
        <Row label="Import data" value="" onPress={importData} />
        <Text style={[type.caption, { color: theme.textFaint, padding: space.lg, paddingTop: space.xs, lineHeight: 18 }]}>
          One JSON file with everything: meals, weights, goals, settings. Your API key never
          travels in it — re-enter that once after restoring on a new phone.
        </Text>
      </Section>

      <Section title="How your numbers work">
        {goal ? (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Line label="BMR (Mifflin-St Jeor)" value={`${Math.round(goal.bmr)} kcal`} />
            <Line label="TDEE (BMR × activity)" value={`${Math.round(goal.tdee)} kcal`} />
            <Line label="Your target" value={`${Math.round(goal.targetKcal)} kcal`} />
            {goal.floorApplied ? (
              <Text style={[type.caption, { color: theme.uncertain, marginTop: space.xs }]}>
                Raised to our safe floor. Your inputs alone gave {Math.round(goal.targetRawKcal)} kcal.
              </Text>
            ) : null}
          </View>
        ) : null}
      </Section>

      <Section title="Start over">
        <Row
          label="Redo onboarding"
          value=""
          onPress={() => {
            Alert.alert(
              'Erase everything and start over?',
              'Deletes your profile, goals, weight history, logged meals and saved API keys from this device, and disconnects publik API. It cannot be undone, and there is no backup on a server because there is no server of ours.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Erase and restart',
                  style: 'destructive',
                  onPress: () => {
                    void resetEverything().then(() => router.replace('/onboarding' as never))
                  },
                },
              ],
            )
          }}
        />
      </Section>

      <Section title="About">
        <Row label="License" value="AGPL-3.0" />
        <Row label="Nutrition data" value="USDA, CC0" />
      </Section>

      <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xl, lineHeight: 19 }]}>
        Nut AI's estimates are AI-generated approximations and may not be accurate. It is not a
        medical device and does not diagnose, treat, cure or prevent any condition. Consult a
        registered dietitian or healthcare provider before making medical decisions.
      </Text>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ marginTop: space.xl }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: space.sm }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: theme.bgSunken }]}>{children}</View>
    </View>
  )
}

function Row({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const theme = useTheme()
  const body = (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Text style={[type.body, { color: theme.text, flex: 1 }]}>{label}</Text>
      {value ? <Text style={[type.body, { color: theme.textMuted }]}>{value}</Text> : null}
      {onPress ? (
        <View style={{ marginLeft: space.sm }}>
          <Icon name="chevron" size={16} color={theme.textFaint} />
        </View>
      ) : null}
    </View>
  )
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  )
}

function Line({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.caption, { color: theme.text, fontWeight: '600' }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { marginTop: space.lg, padding: space.lg, borderRadius: radius.xl },
  group: { borderRadius: radius.xl, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
})
