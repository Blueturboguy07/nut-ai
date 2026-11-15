import { router } from 'expo-router'
import { useEffect } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { PROVIDER_MODELS, providersByPrice, type ProviderId } from '@nutai/prompt'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { OptionCard } from '../../src/components/onboarding/Controls'
import type { IconName } from '../../src/components/Icon'
import { putSetting } from '../../src/data/repo'
import { publikAvailable, publikChoice } from '../../src/inference/publik'
import { APP_NAME } from '../../src/inference/publik-copy'
import { isAdult } from '../../src/onboarding/adult'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * How should Nut AI recognize your food?
 *
 * publik API sits FIRST and PRESELECTED: it is not one of the vendors the user
 * chooses among, it is the app's own default supply, disclosed as such on the
 * next screen (cost, and where the photo goes) before anything is minted.
 *
 * THE VENDOR PICKER BELOW IT IS NEUTRAL. Price-sorted, no "recommended" badge,
 * no pre-selected vendor. Within a chosen provider the cheapest vision model is
 * pre-selected, which is honest rather than a compromise: the literature says
 * frontier models are NOT better at portion estimation, and portion is the
 * dominant error source. Paying 5-30x buys identification quality we already
 * have.
 *
 * Neutrality among the vendors is also the cheapest available mitigation
 * against being treated as a joint controller of the data the user sends to a
 * provider we recommended.
 *
 * publik API (a paid plan) is offered only to an adult: the birth date step
 * comes before this one, and an unknown age counts as a minor.
 */

const LABELS: Record<ProviderId, { name: string; icon: IconName; note: string }> = {
  openai: { name: 'OpenAI', icon: 'scan', note: 'GPT-4o and 4o-mini' },
  google: { name: 'Google', icon: 'scan', note: 'Gemini — paid tier only' },
  anthropic: { name: 'Anthropic', icon: 'scan', note: 'Claude Haiku and Sonnet' },
}

export default function ProviderScreen() {
  const theme = useTheme()
  const a = useAnswers()
  const order = providersByPrice()
  // After "Use my own key" on the sign-in gate, publik API is not offered
  // here again (Profile → AI provider still has it). Never to a minor.
  const publik = publikAvailable() && publikChoice() !== 'own_key' && isAdult(a, Date.now())

  // Preselection is an onboarding behaviour only: a fresh run with no answer
  // yet lands on publik; an existing install with a vendor key is never
  // switched (the resolver reads the settings table, not this store).
  useEffect(() => {
    if (publik && a.provider === undefined) setAnswer('provider', 'publik')
  }, [publik, a.provider])

  return (
    <OnboardingScreen
      step={stepIndex('provider')}
      total={TOTAL_STEPS}
      title={`How should ${APP_NAME} recognize your food?`}
      subtitle={
        publik
          ? 'Scans run on publik API by default: link your publik account for some free use, once. Prefer your own key? Pick a provider. Then your photo goes only to the provider you name.'
          : 'Bring your own API key. Your photo goes to the provider you name and to no other company.'
      }
      ctaDisabled={a.provider === undefined}
      onCta={() => {
        if (a.provider === 'none') void putSetting('provider', 'none')
        // No key: the key step is skipped (and Apple Health only shows when it is in the build).
        router.push(nextRoute(a.provider === 'none' ? 'apikey' : 'provider') as never)
      }}
      scroll
    >
      <ScrollView scrollEnabled={false}>
        {publik ? (
          <OptionCard
            label="publik API"
            sublabel="No key to paste. Link your publik account for some free use, once. AI use counts toward your publik plan."
            glyph="scan"
            selected={a.provider === 'publik'}
            onPress={() => setAnswer('provider', 'publik')}
          />
        ) : null}

        {order.map((p) => {
          // No price per scan (founder rule, Nov 14 2026: no amount of money anywhere).
          return (
            <OptionCard
              key={p}
              label={LABELS[p].name}
              sublabel={LABELS[p].note}
              glyph={LABELS[p].icon}
              selected={a.provider === p}
              onPress={() => setAnswer('provider', p)}
            />
          )
        })}

        <OptionCard
          label="No key for now"
          sublabel="Barcode scans and food search still work. Photo and label scans need an AI provider."
          glyph="minus"
          selected={a.provider === 'none'}
          onPress={() => setAnswer('provider', 'none')}
        />
      </ScrollView>

      <View style={[styles.note, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
          {publik ? 'The three providers below are sorted' : 'Sorted'} by price, with no recommendation. Frontier models are not measurably better at
          judging portion size — which is where nearly all the error is — so the cheapest vision
          model is pre-selected on purpose, not as a compromise.
        </Text>
      </View>

      {a.provider === 'google' ? (
        <View style={[styles.warn, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text, lineHeight: 19 }]}>
            Gemini's free tier is blocked for photo scans. Google's own API terms say "do not submit
            sensitive, confidential, or personal information to the Unpaid Services", and a meal
            photo is health data. A paid Google key works normally.
          </Text>
        </View>
      ) : null}

      {a.provider && a.provider !== 'none' && a.provider !== 'publik' ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          {PROVIDER_MODELS[a.provider].length} models available. You can change the model after you
          enter your key.
        </Text>
      ) : null}
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  note: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
})
