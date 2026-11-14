import Constants from 'expo-constants'
import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import Storage from 'expo-sqlite/kv-store'
import { currentVersion } from '@nutai/db-adapter'
import { ONBOARDING_DONE_KEY } from '../onboarding/done-key'
import { db } from './repo'
import { APP_NAME } from '../inference/publik-copy'
import {
  buildBackupPayload,
  importBackupPayload,
  parseBackup,
  serializeBackup,
  type BackupPayload,
  type ImportOutcome,
  type ParseFailure,
} from './backup-core'

/**
 * The expo-facing half of backup/restore: file I/O and share/pick sheets.
 * All logic that can corrupt data lives in backup-core.ts, under tests.
 *
 * iPad note: sharing presents as an iPhone-style sheet because app.config.ts
 * sets supportsTablet: false. If that flag ever flips, shareAsync needs a
 * real-iPad retest (UIActivityViewController popover anchoring).
 */

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

export interface ExportResult {
  uri: string
  name: string
  shared: boolean
}

export async function exportAndShareBackup(): Promise<ExportResult> {
  const h = await db()
  const payload = await buildBackupPayload(h, {
    schemaVersion: await currentVersion(h),
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    now: Date.now(),
  })
  const json = serializeBackup(payload)

  const dir = new Directory(Paths.cache, 'backups')
  dir.create({ intermediates: true, idempotent: true })
  const name = `nutai-backup-${stamp(new Date())}.json`
  const file = new File(dir, name)
  file.create({ overwrite: true })
  file.write(json)

  let shared = false
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: `Export ${APP_NAME} data`,
    })
    shared = true
  }
  return { uri: file.uri, name, shared }
}

export type PickOutcome =
  | { ok: true; payload: BackupPayload }
  | { ok: false; reason: ParseFailure | 'cancelled' }

/**
 * copyToCacheDirectory matters: it makes the OS copy whatever the user picked
 * (including Android content:// documents from Drive) into our own sandbox
 * and hand back a plain file:// URI — the entire SAF quirk class, sidestepped.
 */
export async function pickBackupFile(): Promise<PickOutcome> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (res.canceled || !res.assets?.[0]) return { ok: false, reason: 'cancelled' }

  // Never trust the picker's MIME filter — providers mislabel. Parse and check.
  const raw = await new File(res.assets[0].uri).text()
  const parsed = parseBackup(raw)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  return { ok: true, payload: parsed.payload }
}

export async function importBackup(payload: BackupPayload): Promise<ImportOutcome> {
  const h = await db()
  return importBackupPayload(h, payload, await currentVersion(h))
}

/** After a successful restore: the app is set up. Skip onboarding forever. */
export async function finishRestore(): Promise<void> {
  await Storage.setItem(ONBOARDING_DONE_KEY, 'true')
}
