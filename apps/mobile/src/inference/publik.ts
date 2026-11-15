import * as Crypto from 'expo-crypto'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import Storage from 'expo-sqlite/kv-store'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { launchValue, printLineAndExit, storefrontCountry } from '../../modules/publik-launch'
import buildConfig from '../../publik-build.json'
import { APP_STORE_BUILD, BUILD_ENV_OVERRIDES, DEV_BUILD, PUBLIK_GATE_MODE } from '../build-flags'
import { clearCredential, loadCredential, saveCredential } from './credentials'
import { PUBLIK_DELETE_ACCOUNT_URL } from './publik-copy'
import {
  allowPublikOrigin,
  appTokenOf,
  emptyWallet,
  ensureSignedIn,
  fetchWallet,
  gateAtStart,
  isSafePublikLink,
  isUsableAppToken,
  notePlanResetsAt,
  pauseTelemetry,
  provision,
  purchaseLinksFor,
  purchaseLinksOn,
  resumeTelemetry,
  revokeInstall,
  setPurchaseLinks,
  stopTelemetry,
  type Choice,
  type GateDevice,
  type GateResult,
  type GateUI,
  type ProvisionResult,
  type PublikBuildConfig,
  type PublikInstall,
  type PublikWallet,
  type PublikWalletPatch,
  type StoredGateKey,
} from './publik-core'

/**
 * publik API — the Expo binding.
 *
 * ABOUT THE APP TOKEN. The app token (pat_) is a publishable identifier, not
 * a credential: it names this app to publikhq.com so an install can mint its
 * own bounded `pk_` key, and it can do nothing else (no reads, no spend, no
 * attribution to anyone but Nut AI). It ships inside every phone build. A
 * release build takes it ONLY from the build input PUBLIK_APP_TOKEN
 * (app.config.ts `extra.publikAppToken`; CI passes the repo secret, and the
 * native build fails without it). The committed `publik-build.json` holds
 * the placeholder and its other settings; its `appToken` may serve a dev
 * build (Metro) only. The rule in `credentials.ts` — keys are written only
 * from runtime user input — still holds: the `pk_` key this token mints is
 * written here into SecureStore, after the user accepts the disclosure, and
 * never appears in source (a test forbids it).
 *
 * The install identity (`publik.install`) lives in SecureStore beside the
 * key; the wallet snapshot (`publik.wallet`) lives in the kv-store. Neither
 * is in a backup — a restore on another phone carries the CHOICE of publik
 * but mints its own install, exactly as it carries the choice of Anthropic
 * but not the Anthropic key.
 */

const INSTALL_KEY = 'publik.install'
const WALLET_KEY = 'publik.wallet'
const TELEMETRY_ID_KEY = 'publik.telemetry_install_id'
/** Profile → publik account → Count app use: '0' is off; anything else (or nothing) is on. */
const COUNT_USE_KEY = 'publik.count_use'

/** The gate's plan choice as it last read or wrote it; screens read it without a SecureStore round trip. */
let choiceCache: Choice | null = null

/**
 * The test hook of the publik module, in a CI test build only (build-flags.ts
 * PUBLIK_TEST_HOOKS): PUBLIK_API_BASE_URL, an environment variable or a
 * launch argument of THIS launch (iOS: `SIMCTL_CHILD_` env or
 * `-PUBLIK_API_BASE_URL <url>`; Android: `am start -e PUBLIK_API_BASE_URL
 * <url>`), points the whole module at another publik, for example the blind
 * test's fake one. Read once per launch. A release build reads nothing.
 */
const LAUNCH_BASE_URL = launchValue('PUBLIK_API_BASE_URL')

/** The build input PUBLIK_APP_TOKEN, as expo-constants wrote it into this build (app.config.ts). */
const BUILD_APP_TOKEN: unknown = (Constants.expoConfig?.extra as { publikAppToken?: unknown } | undefined)?.publikAppToken

export function publikBuildConfig(): PublikBuildConfig {
  // Then the dev override for a preview gateway, inlined by Metro at bundle
  // time. A release build ignores both (BUILD_ENV_OVERRIDES is false there).
  const devBase = BUILD_ENV_OVERRIDES ? process.env.EXPO_PUBLIC_PUBLIK_API_BASE_URL : undefined
  const baseUrl = LAUNCH_BASE_URL || devBase || buildConfig.baseUrl
  // The token: the build input only; the committed file in a dev build only.
  return { ...buildConfig, appToken: appTokenOf(BUILD_APP_TOKEN, buildConfig.appToken, DEV_BUILD), baseUrl }
}

// That publik's links (claim, top up) open like publikhq.com's.
allowPublikOrigin(publikBuildConfig().baseUrl)

/** False when this build has no app token (the placeholder) — then the app is BYO-only. */
export function publikAvailable(): boolean {
  return isUsableAppToken(publikBuildConfig().appToken)
}

export async function loadPublikInstall(): Promise<PublikInstall | null> {
  try {
    const raw = await SecureStore.getItemAsync(INSTALL_KEY)
    return raw ? (JSON.parse(raw) as PublikInstall) : null
  } catch {
    return null
  }
}

async function savePublikInstall(i: PublikInstall): Promise<void> {
  await SecureStore.setItemAsync(INSTALL_KEY, JSON.stringify(i), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

export async function loadPublikWallet(): Promise<PublikWallet | null> {
  try {
    const raw = await Storage.getItem(WALLET_KEY)
    const w = raw ? (JSON.parse(raw) as PublikWallet) : null
    if (w) notePlanResetsAt(w.resetsAt ?? w.weekResetsAt)
    return w
  } catch {
    return null
  }
}

export async function savePublikWallet(w: PublikWallet): Promise<void> {
  // The plan-limit message names this reset when a 402 names none.
  notePlanResetsAt(w.resetsAt ?? w.weekResetsAt)
  await Storage.setItem(WALLET_KEY, JSON.stringify(w))
}

/** The publik key this phone holds now; null when none (or the store cannot be read). */
async function currentKey(): Promise<string | null> {
  try {
    return (await loadCredential('publik'))?.value ?? null
  } catch {
    return null
  }
}

/** Key + install identity both present: the resolver can route to publik. */
export async function publikConnected(): Promise<boolean> {
  const [cred, install] = await Promise.all([loadCredential('publik'), loadPublikInstall()])
  return Boolean(cred && install)
}

function deviceFacts() {
  return {
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    os: (Platform.OS === 'ios' ? 'ios' : 'android') as 'ios' | 'android',
    osVersion: String(Platform.Version),
    // Coarse on purpose (CONTRACT §11.1): enough to tell installs apart on
    // the claim page, nothing that identifies the phone.
    deviceName: Platform.OS === 'ios' ? 'iPhone' : 'Android phone',
  }
}

/**
 * POST /installs. Called by the gate at start when this phone holds no key
 * (Sign in with publik, before any screen of the app), by the disclosure's
 * "Continue with publik API" (onboarding) or "Connect publik API" (settings),
 * and by the bounded re-mint after key_revoked. Never from the capture path.
 *
 * A stored install identity is reused only beside its key (a Reconnect after
 * a revoke gets the same install, no second starter). With no key on this
 * phone (the gate's case) it is never reused: a fresh install_id. If the
 * server answers 200-replay for an install whose key this phone no longer
 * holds, or install_revoked (its owner disconnected it), a fresh install_id
 * is minted exactly once. `force` skips the local short-circuit (Reconnect
 * after a server-side revoke, the bounded re-mint after
 * key_revoked{reprovision}).
 */
export async function connectPublik(
  opts: { force?: boolean } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ProvisionResult> {
  const cfg = publikBuildConfig()
  const existing = await loadPublikInstall()
  const held = await currentKey()
  const facts = deviceFacts()

  // Already connected and not told otherwise (a user stepping back and forth
  // in onboarding): hand back what this phone holds instead of a re-mint.
  if (!opts.force && existing && held) {
    const wallet = (await loadPublikWallet()) ?? emptyWallet(existing.claimState)
    return { ok: true, key: held, install: existing, wallet, starterMicros: 0 }
  }

  let res = await provision({ cfg, installId: existing && held ? existing.installId : Crypto.randomUUID(), ...facts }, fetchImpl)
  if (!res.ok && (res.kind === 'replayed' || res.kind === 'install-revoked')) {
    res = await provision({ cfg, installId: Crypto.randomUUID(), ...facts }, fetchImpl)
    if (!res.ok && res.kind === 'replayed') return { ok: false, kind: 'malformed', status: 200 }
  }
  if (!res.ok) return res

  // The key first, then the identity, then the snapshot — a crash between
  // writes leaves a key the resolver can still find. A re-mint keeps the
  // gate's plan choice: it is the same person on the same phone.
  await saveCredential('publik', { kind: 'api_key', value: res.key })
  const install: PublikInstall = { ...res.install, choice: existing?.choice ?? null }
  await savePublikInstall(install)
  await savePublikWallet(res.wallet)
  return { ...res, install }
}

/**
 * Forget the install identity, the key and the snapshot on this phone (no
 * server call). The install record goes FIRST, then the key. Every delete is
 * tried; a failed one is thrown after the others, never hidden (a missing
 * item is not a failure). An install record left behind with no key is
 * never reused: connectPublik reuses an install ID only beside its key.
 */
export async function forgetPublikLocally(): Promise<void> {
  choiceCache = null
  const failed: string[] = []
  const attempt = async (name: string, del: () => Promise<unknown>) => {
    try {
      await del()
    } catch {
      failed.push(name)
    }
  }
  await attempt(INSTALL_KEY, () => SecureStore.deleteItemAsync(INSTALL_KEY))
  await attempt('key.publik', () => clearCredential('publik'))
  await attempt(WALLET_KEY, () => Storage.removeItem(WALLET_KEY))
  if (failed.length) throw new Error(`publik: this phone could not delete ${failed.join(', ')}`)
}

/**
 * Sign out on this phone, the local half. In this order: the key into memory,
 * the local copies deleted, usage counting stopped. It returns the server
 * half, the revoke (best effort, at most ACCOUNT_CALL_TIMEOUT_MS; publik's
 * idle sweep revokes a key it never hears from), so a caller need not wait
 * for it. No answer from publik can keep the key on the phone.
 */
export async function forgetPublikNow(fetchImpl: typeof fetch = fetch): Promise<() => Promise<void>> {
  const cred = await loadCredential('publik').catch(() => null)
  const install = await loadPublikInstall()
  try {
    await forgetPublikLocally()
  } catch {
    /* a store that cannot be cleared: the revoke still ends the key */
  }
  stopTelemetry()
  return async () => {
    if (!cred) return
    await revokeInstall(install?.baseUrl ?? publikBuildConfig().baseUrl, cred.value, fetchImpl).catch(() => undefined)
  }
}

/** Sign out on this phone, then the revoke (waited for, at most ACCOUNT_CALL_TIMEOUT_MS). */
export async function disconnectPublik(fetchImpl: typeof fetch = fetch): Promise<void> {
  const revoke = await forgetPublikNow(fetchImpl)
  await revoke()
}

/** GET /wallet → snapshot. Also notices a claim that happened on the site. */
export async function refreshPublikWallet(fetchImpl: typeof fetch = fetch): Promise<PublikWallet | null> {
  const cred = await loadCredential('publik')
  const install = await loadPublikInstall()
  if (!cred || !install) return null
  // At most ACCOUNT_CALL_TIMEOUT_MS, the answer's body included.
  const w = await fetchWallet(install.baseUrl, cred.value, install.claimState, fetchImpl)
  if (!w) return null
  // A sign-out (or a new key) while the call was out: write nothing back.
  if ((await currentKey()) !== cred.value) return null
  try {
    const now = await loadPublikInstall()
    if (!now) return null
    await savePublikWallet(w)
    if (w.claimState !== now.claimState || (w.claimUrl && w.claimUrl !== now.claimUrl)) {
      await savePublikInstall({
        ...now,
        claimState: w.claimState,
        claimUrl: w.claimState === 'claimed' ? null : (w.claimUrl ?? now.claimUrl),
      })
    }
    return w
  } catch {
    return null
  }
}

/**
 * The companies publik can send this person's requests to now (GET /wallet
 * `ai_providers`), for the publik AI consent question. Read fresh each time
 * (at most `waitMs`); with no answer in time, the list of the last wallet
 * read. null: publik did not send the list (the question then names no
 * company).
 */
export async function publikAiProviders(waitMs = 4_000): Promise<string[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), waitMs)
  })
  try {
    const fresh = await Promise.race([refreshPublikWallet().catch(() => null), late])
    if (fresh !== 'late' && fresh) return fresh.aiProviders ?? null
    return (await loadPublikWallet())?.aiProviders ?? null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Fold a header PATCH into the stored snapshot (after every metered call).
 *
 * The patch carries only the fields the response named, so a field the
 * gateway stayed silent about keeps its last known value, while a field it
 * explicitly set to `none` — a lapsed week budget, a spent starter — is
 * written as null instead of lingering on the settings card.
 */
export async function notePublikWallet(w: PublikWalletPatch): Promise<void> {
  // The metered call's answer came after a sign-out: write nothing back.
  if (!(await currentKey())) return
  const prev = (await loadPublikWallet()) ?? emptyWallet(w.claimState ?? 'anonymous')
  const merged: PublikWallet = { ...prev, ...w }
  await savePublikWallet(merged)
  const claimState = w.claimState
  if (claimState && claimState !== prev.claimState) {
    const install = await loadPublikInstall()
    if (install && install.claimState !== claimState) {
      await savePublikInstall({ ...install, claimState, claimUrl: claimState === 'claimed' ? null : install.claimUrl })
    }
  }
}

// ---------------------------------------------------------------------------
// Sign in with publik: the phone side of the gate (publik-core.ts)
// ---------------------------------------------------------------------------

/** The gate's plan choice on this phone: 'publik' (Connect your plan), 'own_key', or null (not asked yet). */
export function publikChoice(): Choice | null {
  return choiceCache
}

/**
 * The setting of the publik module: 'publik' after Connect your plan,
 * 'own_key' when the person saves or picks their own key, null to ask again
 * at the next start.
 */
export async function setPublikChoice(choice: Choice | null): Promise<void> {
  choiceCache = choice
  const install = await loadPublikInstall()
  if (install && (install.choice ?? null) !== choice) await savePublikInstall({ ...install, choice })
}

/** The gate's view of the stored key. A store that cannot be read is "no key" (the gate mints a new one), never a lockout. */
async function loadGateCredential(): Promise<StoredGateKey | null> {
  try {
    const [cred, install] = await Promise.all([loadCredential('publik'), loadPublikInstall()])
    if (!cred || !install || !cred.value.startsWith('pk_')) return null
    choiceCache = install.choice ?? null
    return { key: cred.value, claimUrl: install.claimUrl, choice: install.choice ?? null, claimed: install.claimState === 'claimed' }
  } catch {
    return null
  }
}

/** True when this phone holds a key and signed in to publik with it (as last seen). */
export async function publikSignedIn(): Promise<boolean> {
  return Boolean((await loadGateCredential())?.claimed)
}

/** Profile → publik account → Count app use. On unless the person turned it off. */
export async function countAppUse(): Promise<boolean> {
  return (await Storage.getItem(COUNT_USE_KEY)) !== '0'
}

export async function setCountAppUse(on: boolean): Promise<void> {
  await Storage.setItem(COUNT_USE_KEY, on ? '1' : '0')
  if (!on) pauseTelemetry()
  else resumeTelemetry()
}

/**
 * Is the plan screen allowed on this phone? Never for a minor or an unknown
 * age (src/onboarding/adult.ts). The UI layer registers the check, because
 * the age lives in the app's database, which this file does not open.
 */
let planAllowedCheck: () => Promise<boolean> = async () => false
export function setPublikPlanAllowedCheck(check: () => Promise<boolean>): void {
  planAllowedCheck = check
}
export async function publikPlanAllowed(): Promise<boolean> {
  return planAllowedCheck().catch(() => false)
}

/** The gate's GET /wallet, folded into the snapshot the settings card shows. */
async function noteGateWallet(w: PublikWallet): Promise<void> {
  // A sign-out while the gate's call was out: write nothing back.
  if (!(await currentKey())) return
  await savePublikWallet(w)
  const install = await loadPublikInstall()
  if (install && install.claimState !== w.claimState) {
    await savePublikInstall({ ...install, claimState: w.claimState, claimUrl: w.claimState === 'claimed' ? null : (w.claimUrl ?? install.claimUrl) })
  }
}

async function telemetryInstallId(): Promise<string> {
  try {
    const saved = await Storage.getItem(TELEMETRY_ID_KEY)
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved)) return saved
    const fresh = Crypto.randomUUID().toLowerCase()
    await Storage.setItem(TELEMETRY_ID_KEY, fresh)
    return fresh
  } catch {
    // Not saved: this ID lasts for this run only.
    return Crypto.randomUUID().toLowerCase()
  }
}

/**
 * `ms` of foreground time, or (null) no timer; 'resumed' at once when the app
 * comes back to the foreground — the person returning from the browser. A
 * phone pauses the app in the background, so the gate checks only while the
 * app is in front, and checks at once when it is in front again.
 */
function waitInForeground(ms: number | null, signal: AbortSignal): Promise<'timer' | 'resumed'> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let away = AppState.currentState !== 'active'
    let sub: { remove(): void } | null = null
    const finish = (why: 'timer' | 'resumed') => {
      if (timer) clearTimeout(timer)
      sub?.remove()
      signal.removeEventListener('abort', onAbort)
      resolve(why)
    }
    const onAbort = () => finish('timer')
    const arm = () => {
      if (ms !== null && !timer && AppState.currentState === 'active') timer = setTimeout(() => finish('timer'), ms)
    }
    if (signal.aborted) return resolve('timer')
    signal.addEventListener('abort', onAbort)
    sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (away) finish('resumed')
        else arm()
        return
      }
      away = true
      if (timer) clearTimeout(timer)
      timer = null
    })
    arm()
  })
}

/**
 * Opens a publik page (sign in, get a plan, delete account) in an in-app
 * browser sheet (SFSafariViewController on iOS, a Custom Tab on Android),
 * never the Safari app. Resolves when the sheet closes.
 */
export async function openPublikLink(url: string): Promise<void> {
  if (!isSafePublikLink(url)) return
  try {
    await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close', readerMode: false })
  } catch {
    /* a sheet is already open, or no browser: the gate screen stays, with Retry */
  }
}

/** publik saw the sign-in or the plan: close the sheet (iOS; an Android Custom Tab closes when the person comes back). */
export function closePublikLink(): void {
  // A throw (no such call on this platform) and a rejection (nothing open) both end here.
  void Promise.resolve()
    .then(() => WebBrowser.dismissBrowser())
    .catch(() => undefined)
}

/** Usage counting stops while the app is in the background, and runs again in the foreground. */
let appStateWatched = false
function watchAppState(): void {
  if (appStateWatched) return
  appStateWatched = true
  try {
    AppState.addEventListener('change', (state) => {
      if (state === 'background') pauseTelemetry()
      else if (state === 'active') resumeTelemetry()
    })
  } catch {
    appStateWatched = false
  }
}

function phoneDevice(): GateDevice {
  return {
    cfg: publikBuildConfig(),
    os: Platform.OS === 'ios' ? 'ios' : 'android',
    fetch,
    load: loadGateCredential,
    // Always a real POST /installs (the self-test proves the app token); the
    // gate calls it only when this phone holds no key.
    provision: () => connectPublik({ force: true }),
    forget: forgetPublikLocally,
    saveChoice: (choice) => setPublikChoice(choice),
    noteWallet: noteGateWallet,
    planAllowed: publikPlanAllowed,
    purchaseLinks: loadPurchaseLinks,
    countUse: countAppUse,
    wait: waitInForeground,
    value: launchValue,
    printAndExit: printLineAndExit,
    telemetryInstallId,
    log: (line) => console.log(line),
  }
}

/**
 * The gate at app start (app/_layout.tsx → src/components/PublikGate.tsx).
 * required: Sign in with publik before any screen; optional: null at once
 * (no wall, usage counting only for a phone that signed in before).
 */
export function runPublikGate(ui: GateUI): Promise<GateResult | null> {
  watchAppState()
  return gateAtStart(ui, phoneDevice(), PUBLIK_GATE_MODE)
}

/** Sign in with publik when the person asks (optional mode: the AI plan choice, Profile). */
export function runPublikSignIn(ui: GateUI): Promise<GateResult> {
  watchAppState()
  return ensureSignedIn(ui, phoneDevice())
}

const signOutListeners = new Set<() => void>()

/** The gate listens: a sign-out shows Sign in with publik again at once. */
export function onPublikSignOut(listener: () => void): () => void {
  signOutListeners.add(listener)
  return () => {
    signOutListeners.delete(listener)
  }
}

/** Ask for Sign in with publik again now (after Start over, which forgets the key). */
export function requestPublikSignIn(): void {
  stopTelemetry()
  signOutListeners.forEach((listener) => listener())
}

/**
 * Sign out of publik: the key off this phone and usage counting stopped, then
 * Sign in with publik again AT ONCE. The revoke goes in the background (best
 * effort); nobody waits for it, and with no network the sign-out still works.
 */
export async function signOutOfPublik(fetchImpl: typeof fetch = fetch): Promise<void> {
  const revoke = await forgetPublikNow(fetchImpl)
  requestPublikSignIn()
  void revoke()
}

/**
 * Profile → publik account → Delete account, after the person confirmed:
 * sign this phone out (local first), then open publik's account deletion
 * page in the in-app browser. The publik account itself is deleted there,
 * by the person, for every publik app. Resolves when the sheet closes.
 */
export async function deletePublikAccount(fetchImpl: typeof fetch = fetch): Promise<void> {
  const revoke = await forgetPublikNow(fetchImpl)
  // The revoke in the background: the account page opens at once.
  void revoke()
  await openPublikLink(PUBLIK_DELETE_ACCOUNT_URL)
  requestPublikSignIn()
}

// ---------------------------------------------------------------------------
// Purchase links (publik-core.ts purchaseLinksFor)
// ---------------------------------------------------------------------------

let purchaseLinksLoad: Promise<boolean> | null = null

/**
 * May this phone show a link that sells a publik plan? Not an App Store build:
 * yes. An App Store build: only when StoreKit says the storefront is the USA,
 * read once per run; until then, and when it cannot be read, no.
 */
export function loadPurchaseLinks(): Promise<boolean> {
  if (!purchaseLinksLoad) {
    purchaseLinksLoad = (async () => {
      const on = purchaseLinksFor(APP_STORE_BUILD, APP_STORE_BUILD ? await storefrontCountry() : null)
      setPurchaseLinks(on)
      return on
    })().catch(() => {
      setPurchaseLinks(!APP_STORE_BUILD)
      return !APP_STORE_BUILD
    })
  }
  return purchaseLinksLoad
}

// Off at once in an App Store build; the storefront read may turn the links on.
setPurchaseLinks(!APP_STORE_BUILD)
void loadPurchaseLinks()

/** For a screen: the purchase links of this phone (false while the storefront is read in an App Store build). */
export function usePurchaseLinks(): boolean {
  const [on, setOn] = useState<boolean>(purchaseLinksOn)
  useEffect(() => {
    let live = true
    void loadPurchaseLinks().then((v) => {
      if (live) setOn(v)
    })
    return () => {
      live = false
    }
  }, [])
  return on
}
