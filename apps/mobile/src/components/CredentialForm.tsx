import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ActivityIndicator, InputAccessoryView, Keyboard, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { CLAUDE_SUBSCRIPTION_TOKENS } from '../build-flags'
import { putSetting } from '../data/repo'
import { looksPlausible, saveCredential, type CredentialKind } from '../inference/credentials'
import { validateCredential } from '../inference/pathA/validate'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, tap, type } from '../theme/tokens'
import { Icon } from './Icon'

/** The keyboard bar of the key field (iOS). */
const VERIFY_BAR_ID = 'credential-verify'

/**
 * The credential entry + validation form, shared VERBATIM between onboarding
 * and settings. The validation UX here — two Anthropic credential shapes, six
 * named failure states, wrong-tab recovery, raw HTTP detail on failure — is
 * exactly the kind of logic that silently drifts when copy-pasted, and a
 * drifted copy is how "works in onboarding, broken in settings" happens.
 *
 * On success it persists everything scans need (Keychain credential + the
 * provider/provider_model settings the orchestrator reads) and reports up.
 *
 * Only a dev build (Metro) has the "Claude CLI token" tab
 * (build-flags.ts CLAUDE_SUBSCRIPTION_TOKENS). Every other build, Android
 * too, has no tab and refuses a Claude subscription token even when it is
 * pasted as a key: Anthropic does not allow third-party apps to use Claude
 * subscription credentials. An Anthropic API key works as before.
 */
const CLI_TOKEN_TAB = CLAUDE_SUBSCRIPTION_TOKENS

const CONSOLE_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
}

export const PROVIDER_NAME: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export function CredentialForm({
  provider,
  onSaved,
}: {
  provider: ProviderId
  onSaved: (modelId: string) => void
}) {
  const theme = useTheme()
  const [kind, setKind] = useState<CredentialKind>('api_key')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The raw status and body. Shown on failure so a bad key is diagnosable
  // instead of mysterious — a generic message is what made this unfixable.
  const [detail, setDetail] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [shape, setShape] = useState<string | null>(null)

  const model = cheapestModel(provider)
  const plausible = looksPlausible(provider, kind, value)

  async function verify() {
    if (busy || !plausible) return
    setBusy(true)
    setError(null)

    const res = await validateCredential(provider, model.id, { kind: CLI_TOKEN_TAB ? kind : 'api_key', value: value.trim() }, fetch, 15_000, {
      apiKeyOnly: !CLI_TOKEN_TAB,
    })
    setBusy(false)

    if (!res.ok) {
      setError(explain(res.error.kind, res.error.message))
      setDetail(res.detail)
      return
    }
    if (!CLI_TOKEN_TAB && provider === 'anthropic' && res.usedShape === 'bearer') {
      setError('This is a Claude subscription token. This app takes an Anthropic API key only: get one from the Anthropic console. Nothing was saved.')
      setDetail(null)
      return
    }

    // Store the shape the provider ACTUALLY accepted, not the tab that was
    // selected — pasting a CLI token into the API-key tab is the most common
    // mistake here, and correcting it silently beats failing on it.
    const acceptedKind = res.usedShape === 'bearer' ? 'oauth' : 'api_key'
    await saveCredential(provider, { kind: acceptedKind, value: value.trim() })
    await putSetting('provider', provider)
    await putSetting('provider_model', model.id)
    setShape(res.usedShape)
    setOk(true)
    onSaved(model.id)
  }

  return (
    <View>
      {/* Anthropic accepts either shape, so the choice is explicit. */}
      {provider === 'anthropic' && CLI_TOKEN_TAB ? (
        <View style={[styles.tabs, { backgroundColor: theme.bgSunken }]}>
          {(['api_key', 'oauth'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => {
                setKind(k)
                setError(null)
              }}
              style={[styles.tab, kind === k && { backgroundColor: theme.bgElevated }]}
            >
              <Text style={[type.label, { color: kind === k ? theme.text : theme.textMuted }]}>
                {k === 'api_key' ? 'API key' : 'Claude CLI token'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.how, { backgroundColor: theme.bgSunken }]}>
        {provider === 'anthropic' && kind === 'oauth' && CLI_TOKEN_TAB ? (
          <>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Sign in through the Claude CLI</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              On a computer with Claude Code installed, run this and paste what it prints:
            </Text>
            <Pressable
              onPress={() => void Clipboard.setStringAsync('claude setup-token')}
              style={[styles.code, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
            >
              <Text style={[styles.mono, { color: theme.text }]}>claude setup-token</Text>
              <Icon name="bookmark" size={16} color={theme.textFaint} />
            </Pressable>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
              This uses your existing Claude subscription instead of API credit. The check below
              proves it can actually run scans, not just log in.
            </Text>
          </>
        ) : (
          <>
            <Text style={[type.bodyStrong, { color: theme.text }]}>
              Get a key from {PROVIDER_NAME[provider]}
            </Text>
            <Pressable
              onPress={() => void Linking.openURL(CONSOLE_URL[provider])}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm }}
            >
              <Text style={[type.label, { color: theme.protein }]}>Open the console</Text>
              <Icon name="chevron" size={14} color={theme.protein} />
            </Pressable>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
              Billing is between you and {PROVIDER_NAME[provider]}. The key stays on this phone and
              goes only to {PROVIDER_NAME[provider]}.
            </Text>
          </>
        )}
      </View>

      <TextInput
        accessibilityLabel="API credential"
        placeholder={kind === 'oauth' ? 'Paste the token' : 'sk-…'}
        placeholderTextColor={theme.textFaint}
        value={value}
        onChangeText={(t) => {
          setValue(t)
          setError(null)
          setDetail(null)
          setOk(false)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!ok}
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={() => void verify()}
        // iOS: "Verify and save" rides on the keyboard (blind test round 2, N8).
        inputAccessoryViewID={Platform.OS === 'ios' ? VERIFY_BAR_ID : undefined}
        style={[styles.input, { color: theme.text, backgroundColor: theme.bgSunken, borderColor: error ? theme.safety : theme.border }]}
      />

      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={VERIFY_BAR_ID}>
          <View style={[styles.bar, { backgroundColor: theme.bgSunken, borderTopColor: theme.border }]}>
            <Pressable accessibilityRole="button" onPress={() => Keyboard.dismiss()} style={[tap, { paddingHorizontal: space.md }]}>
              <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
            </Pressable>
            {ok ? null : (
              <Pressable
                accessibilityRole="button"
                disabled={busy || !plausible}
                onPress={() => {
                  Keyboard.dismiss()
                  void verify()
                }}
                style={[styles.barVerify, { backgroundColor: theme.text }, (busy || !plausible) && { opacity: 0.4 }]}
              >
                <Text style={[type.bodyStrong, { color: theme.bg }]}>{busy ? 'Checking…' : 'Verify and save'}</Text>
              </Pressable>
            )}
          </View>
        </InputAccessoryView>
      ) : null}

      {busy ? (
        <View style={{ marginTop: space.lg, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textFaint} />
        </View>
      ) : null}

      {error ? (
        <View style={[styles.result, { backgroundColor: theme.safetyBg }]}>
          <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          {detail ? (
            <Text style={[styles.mono, { color: theme.safety, marginTop: space.sm, fontSize: 11 }]}>
              {detail}
            </Text>
          ) : null}
        </View>
      ) : null}

      {ok ? (
        <View style={[styles.result, { backgroundColor: theme.uncertainBg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="check" size={18} color={theme.affirm} weight={2.4} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Key works</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            Verified as {shape === 'bearer' ? 'an OAuth / CLI token' : 'an API key'}. Using{' '}
            {model.label}.
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !plausible}
          onPress={verify}
          style={[
            styles.verify,
            { backgroundColor: theme.text },
            (busy || !plausible) && { opacity: 0.4 },
          ]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {busy ? 'Checking…' : 'Verify and save'}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/** Six named states. "Something went wrong" tells nobody what to do next. */
function explain(kind: string, fallback: string): string {
  switch (kind) {
    case 'key-invalid':
      return CLI_TOKEN_TAB
        ? 'That credential was rejected. Check you copied the whole thing, and that the tab above matches its type — an API key and a CLI token use different headers.'
        : 'That key was rejected. Check that you copied the whole key.'
    case 'quota-exhausted':
      return 'The credential works, but the account is out of credit. Add billing with your provider and try again.'
    case 'model-unavailable':
      return 'The credential works, but that model is not enabled for this account. Some models need billing history before they unlock.'
    case 'offline':
      return 'No connection to the provider. Nothing was saved — try again when you are back online.'
    case 'timeout-ambiguous':
      return 'The check timed out. Nothing was saved.'
    default:
      return fallback
  }
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, marginBottom: space.lg },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  how: { padding: space.lg, borderRadius: radius.lg },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Menlo is iOS-only; Android silently falls back to the default sans unless
  // told 'monospace' explicitly.
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 15 },
  input: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 54,
  },
  result: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barVerify: {
    paddingHorizontal: space.lg,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verify: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
})
