/**
 * The one database interface, with two implementations.
 *
 * PLAN.md §4.1 calls this "the one non-obvious architectural requirement", and it
 * is the reason the whole `packages/*` purity rule exists:
 *
 *   The eval harness must import the REAL gram engine and the REAL resolver and
 *   run them under Node against the golden set. Without a Node-runnable database,
 *   the harness could only score raw model output — which measures the wrong
 *   thing, because the gram engine and resolver sit between the model and the
 *   number a user sees, and that is where much of the accuracy lives.
 *
 * WHERE THE TWO IMPLEMENTATIONS LIVE, and why they are split:
 *
 *   - node:sqlite     -> `@nutai/db-adapter/node`, in this package. Node only.
 *   - expo-sqlite     -> `apps/mobile/src/db`, NOT here.
 *
 * The expo implementation deliberately does not live in this package. `packages/*`
 * must stay importable under bare Node with zero React Native surface, and an
 * `import 'expo-sqlite'` anywhere in here would fail the node-purity gate — which
 * is exactly the gate doing its job. apps/mobile is the only package allowed to
 * hold React Native imports.
 *
 * The interface is ASYNC even though node:sqlite is synchronous, because
 * expo-sqlite is not. Making the shared interface async costs the Node side one
 * trivially-resolved promise per call and saves the app side from a lie.
 */

export type SqlValue = string | number | bigint | Uint8Array | null

export interface RunResult {
  changes: number
  lastInsertRowId: number | bigint
}

export interface DbAdapter {
  /** Rows matching a SELECT. Empty array when nothing matches, never null. */
  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>

  /** First matching row, or null. */
  get<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T | null>

  /** INSERT / UPDATE / DELETE. */
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>

  /** Multi-statement DDL or batch. No parameters. */
  exec(sql: string): Promise<void>

  /**
   * Run `fn` inside a transaction, rolling back if it throws.
   *
   * Every multi-row write goes through this. A meal that is half-written after a
   * crash is worse than a meal that was never written: the diary invariant is
   * that totals are always derivable from the rows, and a partial ingredient
   * array satisfies that invariant while being silently wrong.
   */
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>

  close(): Promise<void>
}

/** Detected capabilities. Checked at startup, not assumed. */
export interface DbCapabilities {
  /**
   * FTS5 is REQUIRED, not optional. The resolver's entire candidate-generation
   * strategy depends on it, and the fallback plan (switching to op-sqlite) is a
   * decision to make at the M0.5 gate and nowhere later. Verified in a real dev
   * client against the real bundled asset, because a simulator answering "yes" is
   * not evidence about a device.
   */
  fts5: boolean
  /** The trigram tokenizer, used as the typo-tolerant shadow index. */
  fts5Trigram: boolean
  sqliteVersion: string
}

export async function detectCapabilities(db: DbAdapter): Promise<DbCapabilities> {
  const version = await db.get<{ v: string }>('SELECT sqlite_version() AS v')

  let fts5 = false
  try {
    await db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS __fts5_probe USING fts5(x)')
    await db.exec('DROP TABLE IF EXISTS __fts5_probe')
    fts5 = true
  } catch {
    fts5 = false
  }

  let fts5Trigram = false
  if (fts5) {
    try {
      await db.exec(
        'CREATE VIRTUAL TABLE IF NOT EXISTS __trigram_probe USING fts5(x, tokenize="trigram")',
      )
      await db.exec('DROP TABLE IF EXISTS __trigram_probe')
      fts5Trigram = true
    } catch {
      fts5Trigram = false
    }
  }

  return { fts5, fts5Trigram, sqliteVersion: version?.v ?? 'unknown' }
}
