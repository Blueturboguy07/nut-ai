import { Pressable, StyleSheet, Text, View } from 'react-native'
import { openPublikLink, usePurchaseLinks } from '../inference/publik'
import {
  APP_NAME,
  DISCLOSURE_DATA_PATH,
  disclosureCostSentence,
  GET_A_PLAN_ELSEWHERE,
  LINK_STARTER_HINT,
  linkButtonLabel,
  planUseLine,
  provisionFailureMessage,
  PRIVACY_URL,
  whyItCostsSentence,
} from '../inference/publik-copy'
import {
  inAppClaimUrl,
  isSafePublikLink,
  planUse,
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
 *   this order: the plan line (a percent of the plan limit with a bar, never
 *   money), the one-sentence justification, and the primary button — "Link this phone & pick a plan" while anonymous, "Get a
 *   plan" once claimed. Never a silent starter: the card is shown
 *   the moment the key exists, with the real plan use on it.
 *
 * In an App Store build outside the US storefront (usePurchaseLinks false)
 * neither surface has a purchase link, a button or a price: one plain
 * sentence (GET_A_PLAN_ELSEWHERE), and "use your own key" (publik-core.ts
 * purchaseLinksFor).
 */

/** The copy lives in publik-copy.ts (pure, tested); this name is kept for the screens. */
export function explainProvision(r: Extract<ProvisionResult, { ok: false }>): string {
  return provisionFailureMessage(r)
}

export function PublikDisclosureBody({ error }: { error: string | null }) {
  const theme = useTheme()
  const links = usePurchaseLinks()
  return (
    <View>
      <View style={[styles.block, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>How AI use is paid</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          {disclosureCostSentence(APP_NAME, links)}
        </Text>
      </View>
      <View style={[styles.block, { backgroundColor: theme.bgSunken, marginTop: space.md }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>Where your photo goes</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          {DISCLOSURE_DATA_PATH}
        </Text>
      </View>
      <Pressable
        onPress={() => void openPublikLink(PRIVACY_URL)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md }}
      >
        <Text style={[type.caption, { color: theme.textFaint }]}>By continuing you agree to the</Text>
        <Text style={[type.label, { color: theme.protein }]}>publik privacy policy</Text>
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

/**
 * The plan line, from the wallet snapshot (CONTRACT §12.1(a)): AI use as a
 * percent of the plan limit ("62% of your plan used · resets Monday"), or
 * "Plan active" / "Plan limit reached" — never an amount of money (founder
 * rule, Nov 14 2026). An unlinked phone names the next step instead.
 */
export function planLine(wallet: PublikWallet | null, purchaseLinks = true): string {
  if (wallet?.claimState === 'claimed') return planUseLine(planUse(wallet))
  // No link to get a plan outside the US storefront of an App Store build.
  if (!purchaseLinks) return 'This phone is not linked to a publik plan yet.'
  return LINK_STARTER_HINT.charAt(0).toUpperCase() + LINK_STARTER_HINT.slice(1)
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
  const links = usePurchaseLinks()
  const claimState = wallet?.claimState ?? install.claimState
  const use = wallet?.claimState === 'claimed' ? planUse(wallet) : null
  // Anonymous: publik's bare in-app claim page (also for a claim link an
  // older version stored). Claimed: the top-up page (US storefront only).
  const claim = install.claimUrl ?? wallet?.claimUrl ?? null
  const link =
    claimState === 'anonymous'
      ? claim && inAppClaimUrl(claim)
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

      <Text style={[type.heading, { color: theme.text, marginTop: space.md }]}>{planLine(wallet, links)}</Text>
      {use && use.usedPercent != null ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="publik plan used"
          accessibilityValue={{ min: 0, max: 100, now: use.usedPercent }}
          style={[styles.track, { backgroundColor: theme.border }]}
        >
          <View
            style={[styles.fill, { width: `${use.usedPercent}%` as const, backgroundColor: use.limitReached ? theme.safety : theme.affirm }]}
          />
        </View>
      ) : null}

      <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 19 }]}>
        {whyItCostsSentence(APP_NAME)}
      </Text>

      {links ? (
        <Pressable
          accessibilityRole="button"
          disabled={!canOpen}
          onPress={() => {
            // The in-app browser sheet, never the Safari app.
            if (canOpen) void openPublikLink(link)
          }}
          style={[styles.primary, { backgroundColor: theme.text }, !canOpen && { opacity: 0.4 }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>{linkButtonLabel(claimState)}</Text>
        </Pressable>
      ) : (
        // No purchase link here (an App Store build outside the US storefront).
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 19 }]}>
          {GET_A_PLAN_ELSEWHERE} Or use your own key in Profile → AI provider.
        </Text>
      )}
      {links && claimState === 'anonymous' ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
          Not now? Link this phone any time for some free use, once, or add your own key in Profile.
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
  track: { height: 8, borderRadius: radius.pill, marginTop: space.sm, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
  primary: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
})
