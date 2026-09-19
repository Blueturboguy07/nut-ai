import * as Crypto from 'expo-crypto'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import Storage from 'expo-sqlite/kv-store'
import { Platform } from 'react-native'
import buildConfig from '../../publik-build.json'
import { clearCredential, loadCredential, saveCredential } from './credentials'
import {
  emptyWallet,
  isUsableAppToken,
  provision,
  walletFromJson,
  type ProvisionResult,
  type PublikBuildConfig,
  type PublikInstall,
  type PublikWallet,
} from './publik-core'

/**
 * publik API — the Expo binding.
 *
 * ABOUT `publik-build.json`. The app token in it is a publishable identifier,
 * not a credential: it names this app to publikhq.com so an install can mint
 * its own bounded `pk_` key, and it can do nothing else (no reads, no spend,
 * no attribution to anyone but Nut AI). It ships inside every phone build,
 * and every phone build is compiled from this public repository, so
 * committing it exposes nothing a build does not. Rotating it is a commit
 * plus a guide pin bump. The rule in `credentials.ts` — keys are written only
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

export function publikBuildConfig(): PublikBuildConfig {
  // Dev override for a preview gateway, inlined by Metro at bundle time. No
  // env override exists for the token: it is a file so an Xcode GUI build
  // (which does not inherit the shell) cannot silently differ.
  const baseUrl = process.env.EXPO_PUBLIC_PUBLIK_API_BASE_URL || buildConfig.baseUrl
  return { ...buildConfig, baseUrl }
}

/** False while the committed token is the placeholder — then the app is BYO-only. */
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
    return raw ? (JSON.parse(raw) as PublikWallet) : null
  } catch {
    return null
  }
}

export async function savePublikWallet(w: PublikWallet): Promise<void> {
  await Storage.setItem(WALLET_KEY, JSON.stringify(w))
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
 * Consent precedes mint: called only from the disclosure's "Continue with
 * publik API" (onboarding) or "Connect publik API" (settings), never at
 * launch and never from the capture path.
 *
 * A stored install identity is reused (a Reconnect after a revoke gets the
 * same install, no second starter). If the server answers 200-replay for an
 * install whose key this phone no longer holds, a fresh install_id is minted
 * exactly once. `force` skips the local short-circuit (Reconnect after a
 * server-side revoke, the bounded re-mint after key_revoked{reprovision}).
 */
export async function connectPublik(
  opts: { force?: boolean } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ProvisionResult> {
  const cfg = publikBuildConfig()
  const existing = await loadPublikInstall()
  const facts = deviceFacts()

  // Already connected and not told otherwise (a user stepping back and forth
  // in onboarding): hand back what this phone holds instead of a re-mint.
  if (!opts.force && existing) {
    const cred = await loadCredential('publik')
    if (cred) {
      const wallet = (await loadPublikWallet()) ?? emptyWallet(existing.claimState)
      return { ok: true, key: cred.value, install: existing, wallet, starterMicros: 0 }
    }
  }

  let res = await provision({ cfg, installId: existing?.installId ?? Crypto.randomUUID(), ...facts }, fetchImpl)
  if (!res.ok && res.kind === 'replayed') {
    res = await provision({ cfg, installId: Crypto.randomUUID(), ...facts }, fetchImpl)
    if (!res.ok && res.kind === 'replayed') return { ok: false, kind: 'malformed', status: 200 }
  }
  if (!res.ok) return res

  // The key first, then the identity, then the snapshot — a crash between
  // writes leaves a key the resolver can still find.
  await saveCredential('publik', { kind: 'api_key', value: res.key })
  await savePublikInstall(res.install)
  await savePublikWallet(res.wallet)
  return res
}

/** Revoke on the server (best effort), then forget everything locally. */
export async function disconnectPublik(fetchImpl: typeof fetch = fetch): Promise<void> {
  const cred = await loadCredential('publik')
  const install = await loadPublikInstall()
  if (cred && install) {
    try {
      await fetchImpl(`${install.baseUrl.replace(/\/+$/, '')}/installs/revoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cred.value}` },
      })
    } catch {
      /* best effort — the idle sweep revokes it server-side eventually */
    }
  }
  await clearCredential('publik')
  try {
    await SecureStore.deleteItemAsync(INSTALL_KEY)
  } catch {
    /* nothing stored */
  }
  await Storage.removeItem(WALLET_KEY)
}

/** GET /wallet → snapshot. Also notices a claim that happened on the site. */
export async function refreshPublikWallet(fetchImpl: typeof fetch = fetch): Promise<PublikWallet | null> {
  const cred = await loadCredential('publik')
  const install = await loadPublikInstall()
  if (!cred || !install) return null
  try {
    const res = await fetchImpl(`${install.baseUrl.replace(/\/+$/, '')}/wallet`, {
      headers: { authorization: `Bearer ${cred.value}` },
    })
    if (!res.ok) return null
    const w = walletFromJson((await res.json()) as Record<string, unknown>, install.claimState)
    await savePublikWallet(w)
    if (w.claimState !== install.claimState || (w.claimUrl && w.claimUrl !== install.claimUrl)) {
      await savePublikInstall({
        ...install,
        claimState: w.claimState,
        claimUrl: w.claimState === 'claimed' ? null : (w.claimUrl ?? install.claimUrl),
      })
    }
    return w
  } catch {
    return null
  }
}

/** Merge a header-derived wallet into the snapshot (called after every metered call). */
export async function notePublikWallet(w: PublikWallet): Promise<void> {
  const prev = (await loadPublikWallet()) ?? emptyWallet(w.claimState)
  await savePublikWallet({ ...prev, ...w, claimUrl: w.claimUrl ?? prev.claimUrl, addCreditUrl: w.addCreditUrl ?? prev.addCreditUrl })
  if (w.claimState !== prev.claimState) {
    const install = await loadPublikInstall()
    if (install && install.claimState !== w.claimState) {
      await savePublikInstall({ ...install, claimState: w.claimState, claimUrl: w.claimState === 'claimed' ? null : install.claimUrl })
    }
  }
}
