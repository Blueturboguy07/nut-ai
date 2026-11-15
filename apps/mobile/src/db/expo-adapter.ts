import type { DbAdapter, RunResult, SqlValue } from '@nutai/db-adapter'
import * as SQLite from 'expo-sqlite'

/**
 * The expo-sqlite implementation of the shared DbAdapter interface.
 *
 * This file lives in apps/mobile and NOT in @nutai/db-adapter, deliberately.
 * `packages/*` must stay importable under bare Node with zero React Native
 * surface (PLAN.md §4.1) so the eval harness can run the real pipeline; an
 * `import 'expo-sqlite'` in that package would fail the node-purity gate. This
 * app is the only place allowed to hold React Native imports.
 *
 * The Node implementation lives at @nutai/db-adapter/node. Both satisfy the same
 * interface, which is what makes "it worked in the harness" mean something on
 * device.
 */
class ExpoDbAdapter implements DbAdapter {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async all<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return (await this.db.getAllAsync(sql, params as SQLite.SQLiteBindValue[])) as T[]
  }

  async get<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return ((await this.db.getFirstAsync(sql, params as SQLite.SQLiteBindValue[])) as T | null) ?? null
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    const r = await this.db.runAsync(sql, params as SQLite.SQLiteBindValue[])
    return { changes: r.changes, lastInsertRowId: r.lastInsertRowId }
  }

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql)
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    let result!: T
    await this.db.withTransactionAsync(async () => {
      result = await fn(this)
    })
    return result
  }

  async close(): Promise<void> {
    await this.db.closeAsync()
  }
}

/** The writable user database. */
export async function openUserDb(): Promise<DbAdapter> {
  const db = await SQLite.openDatabaseAsync('user.db')
  await db.execAsync('PRAGMA foreign_keys = ON;')
  return new ExpoDbAdapter(db)
}

/**
 * The read-only bundled nutrition corpus.
 *
 * The 4.7 MB artifact built by tools/nutrition-data ships as an app asset and is
 * imported into the SQLite directory on first launch, because FTS5 needs a real
 * writable path for its temporary files. The app never writes to it — the copy
 * exists for SQLite's benefit, not ours, and a corpus update replaces the file
 * wholesale rather than mutating it.
 *
 * WITHOUT THIS IMPORT the app opens an EMPTY database of the same name, and every
 * food silently falls to the AI-estimate path — which looks exactly like a
 * resolver bug while actually being a missing asset. Hence `nutritionCorpusInfo`
 * below, so that failure is legible rather than mysterious.
 */
let nutritionReady: Promise<void> | null = null

/**
 * Copy the bundled database into SQLite's directory, once per run.
 *
 * THE REQUIRE IS NOT IN A try BLOCK, on purpose. Metro treats a require
 * inside try/catch as OPTIONAL: a build without the asset bundled anyway,
 * the require threw at run time, the catch took it, and the app opened an
 * EMPTY nutrition.db ("The food database did not load", blind test round 1,
 * Nov 14 2026, B2). The asset is gitignored and made by `npm run
 * data:build`; now a build without it fails at the bundle step. CI builds it
 * (mobile-build.yml) and proves the search in the built app (the food-db
 * self-test).
 *
 * A phone that once ran a build without the asset holds an empty
 * nutrition.db, and the import by name does not replace a file that exists.
 * So when the copy has no foods it is imported again, over the old file.
 */
async function importNutritionDb(): Promise<void> {
  const assetId = require('../../assets/nutrition.db')
  try {
    // Idempotent by name. Re-copying 4.7 MB on every cold start would be a
    // visible delay for nothing.
    await SQLite.importDatabaseFromAssetAsync('nutrition.db', { assetId, forceOverwrite: false })
  } catch {
    // Already imported by a previous launch: the common path.
  }
  let foods = 0
  const check = await SQLite.openDatabaseAsync('nutrition.db', { useNewConnection: true })
  try {
    foods = (await nutritionCorpusInfo(new ExpoDbAdapter(check))).foods
  } finally {
    await check.closeAsync().catch(() => undefined)
  }
  if (foods === 0) {
    await SQLite.importDatabaseFromAssetAsync('nutrition.db', { assetId, forceOverwrite: true })
  }
}

export async function openNutritionDb(): Promise<DbAdapter> {
  if (!nutritionReady) {
    nutritionReady = importNutritionDb().catch((e: unknown) => {
      // The next open tries again.
      nutritionReady = null
      throw e
    })
  }
  await nutritionReady

  const db = await SQLite.openDatabaseAsync('nutrition.db')
  return new ExpoDbAdapter(db)
}

/**
 * Confirm the corpus actually arrived.
 *
 * A build shipped without the asset answers every query with zero rows, which is
 * indistinguishable at the UI from "no match found". Surfacing the row count
 * turns a silent, confusing failure into an obvious one.
 */
export async function nutritionCorpusInfo(
  db: DbAdapter,
): Promise<{ foods: number; portions: number; builtAt: string | null }> {
  try {
    const foods = await db.get<{ c: number }>('SELECT COUNT(*) c FROM foods')
    const portions = await db.get<{ c: number }>('SELECT COUNT(*) c FROM food_portions')
    const built = await db.get<{ value: string }>(
      "SELECT value FROM build_manifest WHERE key = 'built_at'",
    )
    return { foods: foods?.c ?? 0, portions: portions?.c ?? 0, builtAt: built?.value ?? null }
  } catch {
    return { foods: 0, portions: 0, builtAt: null }
  }
}
