import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Linking } from 'react-native'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ProviderId } from '@nutai/prompt'
import { availability, requestPermissions } from '../../src/health/healthkit'
import { exportAndShareBackup, finishRestore, importBackup, pickBackupFile } from '../../src/data/backup'
import { currentGoal, resetEverything, setting, type CurrentGoal } from '../../src/data/repo'
import { loadCredential, maskCredential } from '../../src/inference/credentials'
import { PUBLIK_GATE_MODE } from '../../src/build-flags'
import {
  countAppUse,
  deletePublikAccount,
  loadPublikWallet,
  publikConnected,
  publikSignedIn,
  requestPublikSignIn,
  setCountAppUse,
  signOutOfPublik,
} from '../../src/inference/publik'
import { planUse } from '../../src/inference/publik-core'
import { APP_NAME, planUseLine } from '../../src/inference/publik-copy'
import { PROVIDER_NAME } from '../../src/components/CredentialForm'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Profile.
 *
 * A plain settings list, without anything that only exists to extract money
 * or attention:
 *
 *   NO "Refer a friend and earn $10" — a referral bounty is a growth mechanic,
 *   and there is no money here to pay it with.
 *   NO "Upgrade to Family Plan", no Premium crown. There is no paid tier.
 *   publik account: Sign in with publik (optional builds), Sign out, Delete
 *     account (the publik account is deleted on publikhq.com, in the in-app
 *     browser; the food log on this phone is kept or deleted, as the person
 *     says) and Count app use. The food log itself has no account: it is only
 *     on this phone, and "Start over" deletes it.
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
  const [signedIn, setSignedIn] = useState(false)
  const [countUse, setCountUse] = useState(true)
  const [accountBusy, setAccountBusy] = useState(false)
  const [round, setRound] = useState(0)

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
        const [inNow, counting] = await Promise.all([
          publikSignedIn().catch(() => false),
          countAppUse().catch(() => true),
        ])
        if (!alive) return
        setSignedIn(inNow)
        setCountUse(counting)
        setHealthAvail(avail === 'available' ? 'available' : avail === 'not-ios' ? 'not-ios' : 'unavailable')
        if (!p || p === 'none') {
          setProviderLabel('Not connected')
        } else if (p === 'publik') {
          const [connected, wallet] = await Promise.all([publikConnected(), loadPublikWallet()])
          if (!alive) return
          // AI use as a percent of the plan limit, never money (founder rule,
          // Nov 14 2026); an unlinked phone says so.
          setProviderLabel(
            !connected
              ? 'publik API · disconnected'
              : wallet?.claimState !== 'claimed'
                ? 'publik API · not linked'
                : `publik API · ${planUseLine(planUse(wallet))}`,
          )
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
    }, [round]),
  )

  const optional = PUBLIK_GATE_MODE === 'optional'

  function signOut() {
    Alert.alert(
      'Sign out of publik?',
      optional
        ? 'This phone forgets its publik key. Your food log stays on this phone.'
        : `This phone forgets its publik key. Sign in again to use ${APP_NAME}. Your food log stays on this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            setAccountBusy(true)
            void signOutOfPublik()
              .catch(() => undefined)
              .finally(() => {
                setAccountBusy(false)
                setRound((n) => n + 1)
              })
          },
        },
      ],
    )
  }

  function deleteAccount() {
    if (accountBusy) return
    Alert.alert(
      'Delete your publik account?',
      `Your publik account is one account for all publik apps, not only ${APP_NAME}. You delete it on publikhq.com, on the page that opens next. First, this phone signs out of publik.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: askFoodLog },
      ],
    )
  }

  function askFoodLog() {
    Alert.alert(
      'Also delete your food log?',
      'Your meals, weights, goals and saved API keys are only on this phone. publik does not have them. You can keep them or delete them.',
      [
        { text: 'Keep food log', onPress: () => void finishDelete(false) },
        { text: 'Delete food log', style: 'destructive', onPress: () => void finishDelete(true) },
      ],
    )
  }

  async function finishDelete(wipe: boolean) {
    setAccountBusy(true)
    try {
      // The food log first: the publik sign-in can show again when the
      // account page closes (deletePublikAccount), and nothing may delete a
      // key that a new sign-in made.
      if (wipe) await resetEverything().catch(() => undefined)
      await deletePublikAccount().catch(() => undefined)
    } finally {
      setAccountBusy(false)
    }
    if (wipe && optional) router.replace('/onboarding')
    else setRound((n) => n + 1)
  }

  function changeCountUse(on: boolean) {
    setCountUse(on)
    void setCountAppUse(on).catch(() => setCountUse(!on))
  }

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
          Alert.alert('Not a backup', `That doesn't look like a ${APP_NAME} backup file.`)
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
                    Alert.alert('Cannot restore', `This backup is from a newer version of ${APP_NAME} — update the app first.`)
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
        <Text style={[type.bodyStrong, { color: theme.text }]}>Your food log stays on this phone</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          Meals, weights and goals are stored only on this device, and we keep no copy. A meal photo
          goes to the AI provider you choose, so that it can read the photo.
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

      <Section title="publik account">
        {optional && !signedIn ? (
          <Row label="Sign in with publik" value="" onPress={() => router.push('/publik-sign-in' as never)} />
        ) : null}
        {!optional || signedIn ? (
          <Row label={accountBusy ? 'Working…' : 'Sign out'} value="" onPress={accountBusy ? undefined : signOut} />
        ) : null}
        <Row label="Delete account" value="" onPress={accountBusy ? undefined : deleteAccount} />
        <View style={[styles.row, { borderBottomColor: theme.border }]}>
          <Text style={[type.body, { color: theme.text, flex: 1 }]}>Count app use</Text>
          <Switch accessibilityLabel="Count app use" value={countUse} onValueChange={changeCountUse} />
        </View>
        <Text style={[type.caption, { color: theme.textFaint, padding: space.lg, paddingTop: space.xs, lineHeight: 18 }]}>
          When this is on, publik counts when {APP_NAME} opens and how long it stays open. The count
          has no food data and no photos.{optional ? ' Nothing is counted before you sign in.' : ''}
        </Text>
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
              'Deletes your profile, goals, weight history, logged meals and saved API keys from this device, and signs this phone out of publik. You cannot undo it. We keep no copy of your food log, so export it first if you want to keep it.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Erase and restart',
                  style: 'destructive',
                  onPress: () => {
                    // Required mode: the key is gone, so Sign in with publik
                    // shows again; after it, the onboarding gate opens
                    // onboarding. Optional mode has no wall: onboarding now.
                    void resetEverything()
                      .catch(() => undefined)
                      .then(() => {
                        requestPublikSignIn()
                        if (optional) router.replace('/onboarding')
                      })
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
        {APP_NAME}'s estimates are AI-generated approximations and may not be accurate. It is not a
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
