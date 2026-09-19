import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PROVIDER_MODELS, providersByPrice, type ProviderId } from '@nutai/prompt'
import { CredentialForm, PROVIDER_NAME } from '../src/components/CredentialForm'
import { Icon } from '../src/components/Icon'
import { explainProvision, PublikCard, PublikDisclosureBody } from '../src/components/PublikDisclosure'
import { putSetting, recordConsent, setting } from '../src/data/repo'
import { clearCredential, loadCredential, maskCredential } from '../src/inference/credentials'
import {
  connectPublik,
  disconnectPublik,
  loadPublikInstall,
  loadPublikWallet,
  publikAvailable,
  publikBuildConfig,
  refreshPublikWallet,
} from '../src/inference/publik'
import { PUBLIK_MODELS, type PublikInstall, type PublikWallet } from '../src/inference/publik-core'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Provider settings — everything the onboarding key screen can do, available
 * forever. Change provider, change model, re-verify a key, clear it. Nothing
 * decided during onboarding is a life sentence.
 *
 * publik API is the first chip when the build carries an app token. Its card
 * is the same component the onboarding first-run card uses (CONTRACT §12.2):
 * balance, justification, and the link button for as long as the install is
 * anonymous — "Add a plan or pack" once it is claimed.
 */

type Chip = ProviderId | 'publik'

/** The two-entry publik model list; publik-smart only once the phone is linked. */
function publikModelList(claimState: 'anonymous' | 'claimed'): Array<{ id: string; label: string; note: string }> {
  const list: Array<{ id: string; label: string; note: string }> = [
    { id: PUBLIK_MODELS.balanced, label: 'publik-balanced', note: 'Default for photos — the mid tier; identification detail is what a dearer model buys, and portion error does not shrink with it' },
    { id: PUBLIK_MODELS.fast, label: 'publik-fast', note: 'Cheapest tier; try it for scans once you are happy with the default' },
  ]
  if (claimState === 'claimed') list.push({ id: PUBLIK_MODELS.smart, label: 'publik-smart', note: 'Top tier; costs the most per scan' })
  return list
}

export default function ProviderSettings() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [provider, setProvider] = useState<Chip>('anthropic')
  const [modelId, setModelId] = useState<string>('')
  const [masked, setMasked] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [publikInstall, setPublikInstall] = useState<PublikInstall | null>(null)
  const [publikWallet, setPublikWallet] = useState<PublikWallet | null>(null)
  const [publikBusy, setPublikBusy] = useState(false)
  const [publikError, setPublikError] = useState<string | null>(null)
  const publik = publikAvailable()

  const loadPublik = useCallback(async () => {
    const [install, cred, wallet] = await Promise.all([loadPublikInstall(), loadCredential('publik'), loadPublikWallet()])
    const connected = Boolean(install && cred)
    setPublikInstall(connected ? install : null)
    setPublikWallet(connected ? wallet : null)
    if (connected) {
      const fresh = await refreshPublikWallet()
      if (fresh) {
        setPublikWallet(fresh)
        setPublikInstall(await loadPublikInstall())
      }
    }
    return connected
  }, [])

  const refresh = useCallback(() => {
    void (async () => {
      const p = (await setting('provider')) as Chip | 'none' | ''
      const active: Chip = p && p !== 'none' ? p : publik ? 'publik' : 'anthropic'
      setProvider(active)
      setModelId(await setting('provider_model'))
      if (active === 'publik') {
        setMasked(null)
        setShowForm(false)
        await loadPublik()
        return
      }
      const cred = await loadCredential(active)
      setMasked(cred ? maskCredential(cred.value) : null)
      setShowForm(!cred)
      void loadPublik()
    })()
  }, [publik, loadPublik])
  useFocusEffect(refresh)

  function connect() {
    if (publikBusy) return
    setPublikBusy(true)
    setPublikError(null)
    void (async () => {
      const r = await connectPublik({ force: true })
      if (!r.ok) {
        setPublikBusy(false)
        setPublikError(explainProvision(r))
        return
      }
      const scanModel = publikBuildConfig().models.scan
      await putSetting('provider', 'publik')
      await putSetting('provider_model', scanModel)
      await recordConsent('publik.disclosure', String(r.install.disclosureVersion))
      setPublikBusy(false)
      refresh()
    })()
  }

  function disconnect() {
    Alert.alert(
      'Disconnect publik API?',
      "This phone's publik key is revoked and forgotten. Photo scans stop working until you reconnect or add your own key. Your logged data is not touched.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await disconnectPublik()
              await putSetting('provider', 'none')
              refresh()
            })()
          },
        },
      ],
    )
  }

  function useOwnKey() {
    const cheapest = providersByPrice()[0]!
    setProvider(cheapest)
    setMasked(null)
    setShowForm(true)
  }

  const chips: Chip[] = [...(publik ? (['publik'] as const) : []), ...providersByPrice()]
  const chipLabel = (c: Chip) => (c === 'publik' ? 'publik API' : PROVIDER_NAME[c])

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + space.sm }]}>
        <Text style={[type.title, { color: theme.text }]}>AI provider</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Icon name="close" size={22} color={theme.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        <View style={styles.chipRow}>
          {chips.map((p) => (
            <Pressable
              key={p}
              onPress={() => {
                setProvider(p)
                setPublikError(null)
                if (p === 'publik') {
                  setMasked(null)
                  setShowForm(false)
                  void (async () => {
                    const connected = await loadPublik()
                    if (connected) {
                      await putSetting('provider', 'publik')
                      const m = publikBuildConfig().models.scan
                      setModelId(m)
                      await putSetting('provider_model', m)
                    }
                  })()
                  return
                }
                setShowForm(true)
                void (async () => {
                  const cred = await loadCredential(p)
                  setMasked(cred ? maskCredential(cred.value) : null)
                  setShowForm(!cred)
                  if (cred) {
                    await putSetting('provider', p)
                    const m = PROVIDER_MODELS[p][0]!.id
                    setModelId(m)
                    await putSetting('provider_model', m)
                  }
                })()
              }}
              style={[
                styles.chip,
                provider === p
                  ? { backgroundColor: theme.text }
                  : { borderWidth: 1.5, borderColor: theme.border },
              ]}
            >
              <Text style={[type.label, { color: provider === p ? theme.bg : theme.text }]}>
                {chipLabel(p)}
              </Text>
            </Pressable>
          ))}
        </View>

        {provider === 'publik' ? (
          publikInstall ? (
            <>
              <View style={{ marginTop: space.lg }}>
                <PublikCard
                  install={publikInstall}
                  wallet={publikWallet}
                  starterMicros={null}
                  secondary={[
                    { label: 'Use my own key instead', onPress: useOwnKey },
                    { label: 'Disconnect publik API', onPress: disconnect, destructive: true },
                  ]}
                />
              </View>

              <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Model</Text>
              <View style={{ marginTop: space.sm, gap: space.sm }}>
                {publikModelList(publikWallet?.claimState ?? publikInstall.claimState).map((m) => {
                  const active = m.id === modelId
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => {
                        setModelId(m.id)
                        void putSetting('provider_model', m.id)
                      }}
                      style={[styles.modelRow, { borderColor: active ? theme.text : theme.border, borderWidth: active ? 2 : StyleSheet.hairlineWidth }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[type.bodyStrong, { color: theme.text }]}>{m.label}</Text>
                        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, lineHeight: 18 }]}>{m.note}</Text>
                      </View>
                      {active ? <Icon name="check" size={18} color={theme.text} weight={2.4} /> : null}
                    </Pressable>
                  )
                })}
              </View>
              <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
                Every scan is priced per use at 50% of the model's published list price. You can see each charge on your publik dashboard.
              </Text>
            </>
          ) : (
            <View style={{ marginTop: space.lg }}>
              <PublikDisclosureBody error={publikError} />
              <Pressable
                accessibilityRole="button"
                disabled={publikBusy}
                onPress={connect}
                style={[styles.primary, { backgroundColor: theme.text }, publikBusy && { opacity: 0.4 }]}
              >
                <Text style={[type.bodyStrong, { color: theme.bg }]}>{publikBusy ? 'Connecting…' : 'Connect publik API'}</Text>
              </Pressable>
            </View>
          )
        ) : null}

        {provider !== 'publik' && masked ? (
          <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="check" size={16} color={theme.affirm} weight={2.4} />
              <Text style={[type.bodyStrong, { color: theme.text }]}>Key saved</Text>
              <Text style={[type.body, { color: theme.textMuted }]}>{masked}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.md }}>
              <Pressable onPress={() => setShowForm(true)} hitSlop={space.sm}>
                <Text style={[type.label, { color: theme.protein }]}>Replace key</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Remove this key?',
                    `Photo scans stop working until you add a ${PROVIDER_NAME[provider]} key again${publik ? ' or turn on publik API' : ''}. Your logged data is not touched.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => {
                          void (async () => {
                            await clearCredential(provider)
                            await putSetting('provider', 'none')
                            refresh()
                          })()
                        },
                      },
                    ],
                  )
                }
                hitSlop={space.sm}
              >
                <Text style={[type.label, { color: theme.safety }]}>Remove key</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {provider !== 'publik' && showForm ? (
          <View style={{ marginTop: space.lg }}>
            <CredentialForm
              provider={provider}
              onSaved={(m) => {
                setModelId(m)
                refresh()
              }}
            />
          </View>
        ) : null}

        {provider !== 'publik' && masked ? (
          <>
            <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Model</Text>
            <View style={{ marginTop: space.sm, gap: space.sm }}>
              {PROVIDER_MODELS[provider].map((m) => {
                const active = m.id === modelId
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      setModelId(m.id)
                      void putSetting('provider_model', m.id)
                    }}
                    style={[styles.modelRow, { borderColor: active ? theme.text : theme.border, borderWidth: active ? 2 : StyleSheet.hairlineWidth }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyStrong, { color: theme.text }]}>{m.label}</Text>
                      <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                        ~${m.approxScanCostUsd.toFixed(4)} per scan
                      </Text>
                    </View>
                    {active ? <Icon name="check" size={18} color={theme.text} weight={2.4} /> : null}
                  </Pressable>
                )
              })}
            </View>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
              The cheapest vision model is the honest default: frontier models are not measurably
              better at portion size, which is where nearly all the error lives.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  card: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
  },
  primary: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
})
