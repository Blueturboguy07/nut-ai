import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  APP_NAME,
  DISCLOSURE_DATA_PATH,
  disclosureCostSentence,
  linkButtonLabel,
  TERMS_URL,
  whyItCostsSentence,
} from '../inference/publik-copy'
import {
  formatMicros,
  isSafePublikLink,
  type ProvisionResult,
  type PublikInstall,
  type PublikWallet,
} from '../inference/publik-core'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'
import { Icon } from './Icon'

/**
 * The two publik API surfaces, shared VERBATIM between onboarding and
 * settings (the CredentialForm rule: one component, so the copy cannot
 * drift):
 *
 *   PublikDisclosureBody — BEFORE the mint. The two disclosures a phone owes
 *   (cost, and where the photo goes) and the terms link. Consent is the
 *   "Continue with publik API" button the parent screen renders.
 *
 *   PublikCard — AFTER the mint, and forever in settings (CONTRACT §12). In
 *   this order: the balance line, the one-sentence justification, and the
 *   primary button — "Link this phone & pick a plan" while anonymous, "Add a
 *   plan or pack" once claimed. Never a silent starter: the card is shown
 *   the moment the key exists, with the real balance on it.
 */

export function explainProvision(r: Extract<ProvisionResult, { ok: false }>): string {
  switch (r.kind) {
    case 'offline':
      return 'No connection. Nothing was set up — try again when you are back online, or use your own key.'
    case 'rate-limited':
      return `publik API is busy setting up new phones. Try again in ${r.retryAfterSec && r.retryAfterSec > 60 ? 'a few minutes' : 'a minute'}, or use your own key.`
    case 'token-revoked':
    case 'unavailable':
      return 'publik API is not available for this build right now. Use your own key for now — you can switch later in Profile.'
    case 'replayed':
    case 'malformed':
      return `publik API answered in a shape this build does not understand. Update ${APP_NAME}, or use your own key.`
  }
}

export function PublikDisclosureBody({ error }: { error: string | null }) {
  const theme = useTheme()
  return (
    <View>
      <View style={[styles.block, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>Cost</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          {disclosureCostSentence(APP_NAME)}
        </Text>
      </View>
      <View style={[styles.block, { backgroundColor: theme.bgSunken, marginTop: space.md }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>Where your photo goes</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          {DISCLOSURE_DATA_PATH}
        </Text>
      </View>
      <Pressable
        onPress={() => void Linking.openURL(TERMS_URL)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md }}
      >
        <Text style={[type.caption, { color: theme.textFaint }]}>By continuing you agree to the</Text>
        <Text style={[type.label, { color: theme.protein }]}>publik API terms</Text>
        <Icon name="chevron" size={12} color={theme.protein} />
      </Pressable>
      {error ? (
        <View style={[styles.block, { backgroundColor: theme.safetyBg, marginTop: space.lg }]}>
          <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** The balance line, from the wallet snapshot (CONTRACT §12.1(a)). */
export function balanceLine(wallet: PublikWallet | null, starterMicros: number | null): string {
  const bal = wallet?.balanceMicros ?? null
  if (wallet?.claimState === 'claimed') {
    const week =
      wallet.weekBudgetMicros != null && wallet.weekUsedMicros != null
        ? ` · This week ${formatMicros(wallet.weekUsedMicros)} of ${formatMicros(wallet.weekBudgetMicros)}`
        : ''
    return `${formatMicros(bal)} left${week}`
  }
  if (bal == null) return 'Free starter usage'
  const untouched = starterMicros != null && starterMicros > 0 && bal >= starterMicros
  return untouched ? `${formatMicros(bal)} of free starter usage` : `${formatMicros(bal)} of free starter usage left`
}

export function PublikCard({
  install,
  wallet,
  starterMicros,
  secondary,
}: {
  install: PublikInstall
  wallet: PublikWallet | null
  /** The starter grant from the mint reply; null when unknown (settings, later). */
  starterMicros: number | null
  /** Optional text actions under the primary button (Disconnect, Use my own key…). */
  secondary?: Array<{ label: string; onPress: () => void; destructive?: boolean }>
}) {
  const theme = useTheme()
  const claimState = wallet?.claimState ?? install.claimState
  const link =
    claimState === 'anonymous'
      ? (install.claimUrl ?? wallet?.claimUrl ?? null)
      : (wallet?.addCreditUrl ?? 'https://publikhq.com/dashboard/api/add')
  const canOpen = isSafePublikLink(link)

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="check" size={16} color={theme.affirm} weight={2.4} />
        <Text style={[type.bodyStrong, { color: theme.text }]}>publik API</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {claimState === 'claimed' ? 'Linked' : 'Ready'}
        </Text>
      </View>

      <Text style={[type.heading, { color: theme.text, marginTop: space.md }]}>{balanceLine(wallet, starterMicros)}</Text>

      <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 19 }]}>
        {whyItCostsSentence(APP_NAME)}
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={!canOpen}
        onPress={() => {
          if (canOpen) void Linking.openURL(link)
        }}
        style={[styles.primary, { backgroundColor: theme.text }, !canOpen && { opacity: 0.4 }]}
      >
        <Text style={[type.bodyStrong, { color: theme.bg }]}>{linkButtonLabel(claimState)}</Text>
      </Pressable>
      {claimState === 'anonymous' ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
          Not now? Keep scanning on the free starter — nothing is charged behind your back.
        </Text>
      ) : null}

      {secondary && secondary.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.md }}>
          {secondary.map((s) => (
            <Pressable key={s.label} onPress={s.onPress} hitSlop={space.sm}>
              <Text style={[type.label, { color: s.destructive ? theme.safety : theme.protein }]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { padding: space.lg, borderRadius: radius.lg },
  card: { padding: space.lg, borderRadius: radius.lg },
  primary: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
})
