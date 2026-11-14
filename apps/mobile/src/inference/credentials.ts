import * as SecureStore from 'expo-secure-store'
import type { ProviderId } from '@nutai/prompt'

/**
 * API credentials.
 *
 * WHERE KEYS LIVE, and the rules that are not negotiable:
 *
 *   Keychain / Keystore via expo-secure-store, ONE ENTRY PER PROVIDER — never one
 *   combined JSON blob, so a corrupt or revoked key for one provider cannot take
 *   the others with it.
 *
 *   Written ONLY from runtime user input. Never from EXPO_PUBLIC_*, app.config,
 *   .env, or EAS secrets — anything in those ships inside the bundle and is
 *   readable by anyone who downloads the app.
 *
 *   Read at exactly ONE place (the Path A request builder) and sent to exactly
 *   one destination: the provider the user named.
 *
 * The biometric gate is on REVEAL/EDIT in settings only, never on read-for-scan.
 * Putting Face ID in front of every meal photo is how a privacy feature becomes
 * the reason someone stops logging.
 */

export type CredentialKind = 'api_key' | 'oauth'

/**
 * One Keychain slot per provider, plus `publik` for the `pk_` key publik API
 * mints on this phone. The publik slot is written by `publik.ts` after the
 * user accepts the disclosure — still runtime, still never from source — and
 * publik code never touches the three vendor slots.
 */
export type CredentialSlot = ProviderId | 'publik'

export interface StoredCredential {
  kind: CredentialKind
  value: string
}

const keyFor = (p: CredentialSlot) => `key.${p}`
const kindFor = (p: CredentialSlot) => `kind.${p}`

/**
 * Both entries are THIS_DEVICE_ONLY: never in an iCloud or iTunes backup and
 * never synced. On Android, expo-secure-store's config plugin keeps its store
 * out of Auto Backup (app.config.ts plugins).
 */
export async function saveCredential(
  provider: CredentialSlot,
  cred: StoredCredential,
): Promise<void> {
  const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
  await SecureStore.setItemAsync(keyFor(provider), cred.value, opts)
  await SecureStore.setItemAsync(kindFor(provider), cred.kind, opts)
}

/**
 * The stored credential, or null. A store that cannot be read (a keychain
 * error, an Android key lost after a restore) is "no key": the person adds
 * the key again, or the publik gate mints a new one. Never a lockout.
 */
export async function loadCredential(provider: CredentialSlot): Promise<StoredCredential | null> {
  try {
    const value = await SecureStore.getItemAsync(keyFor(provider))
    if (!value) return null
    const kind = (await SecureStore.getItemAsync(kindFor(provider))) as CredentialKind | null
    return { kind: kind ?? 'api_key', value }
  } catch {
    return null
  }
}

export async function clearCredential(provider: CredentialSlot): Promise<void> {
  for (const k of [keyFor(provider), kindFor(provider)]) {
    try {
      await SecureStore.deleteItemAsync(k)
    } catch {
      /* nothing stored, or a store that cannot be read: nothing to keep either */
    }
  }
}

/** `sk-ant-…a8f2` — never the whole thing, not even to its owner by default. */
export function maskCredential(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}

/**
 * Is this worth spending a network round trip on?
 *
 * LENGTH ONLY, deliberately. An earlier version required an `sk-ant-` prefix for
 * Anthropic, which meant pasting a valid `claude setup-token` credential into the
 * API-key tab left the Verify button greyed out with no explanation — the user
 * had a working credential and no way to submit it.
 *
 * Prefixes also change without notice, and the provider is the authority on
 * whether a credential is real. Guessing here can only produce false negatives we
 * never learn about; the probe produces a true answer either way.
 */
export function looksPlausible(_provider: ProviderId, _kind: CredentialKind, value: string): boolean {
  return value.trim().length >= 20
}
