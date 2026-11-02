import { DatabaseSync } from 'node:sqlite'
import type { DbAdapter, RunResult, SqlValue } from './types.js'

/**
 * The node:sqlite implementation. NODE ONLY.
 *
 * This file is never imported by apps/mobile. It is reachable as
 * `@nutai/db-adapter/node`, which the app does not import and Metro therefore
 * never resolves.
 *
 * Its whole reason to exist is the eval harness: the harness runs the REAL
 * resolver and the REAL gram engine against the golden set under Node, and
 * scoring raw model output instead would measure the wrong thing.
 *
 * Why node:sqlite and not better-sqlite3 (Nov 1 2026): better-sqlite3 is a
 * native module, and npm rebuilt it with node-gyp on every install even though
 * the tarball ships a prebuilt binary — on a Windows PC without the Visual
 * Studio C++ build tools `npm install` died with "Could not find any Visual
 * Studio installation to use", and the nutrition-corpus build and the phone
 * build fell over after it. node:sqlite is built into Node 22.13+, needs no
 * compiler, and carries FTS5 with the trigram tokenizer the resolver depends
 * on (detectCapabilities checks, never assumes).
 */

/**
 * node:sqlite is synchronous. The shared interface is async because
 * expo-sqlite is. Wrapping sync calls in resolved promises costs a microtask and
 * keeps one honest interface instead of two divergent ones.
 */
class NodeDbAdapter implements DbAdapter {
  constructor(private readonly db: DatabaseSync) {}

  // Every method is declared `async` rather than returning Promise.resolve(...).
  //
  // That is not a style choice. node:sqlite throws SYNCHRONOUSLY on a
  // constraint violation, so `return Promise.resolve(stmt.run(...))` throws before
  // a promise ever exists — and a caller writing `db.run(...).catch(...)` against
  // an async-looking interface would never see it. `async` converts those throws
  // into rejections, so the interface behaves the way its type says it does.
  async all<T = Record<string, SqlValue>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[]
  }

  async get<T = Record<string, SqlValue>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T | null> {
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    const info = this.db.prepare(sql).run(...params)
    return { changes: Number(info.changes), lastInsertRowId: info.lastInsertRowid }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  /**
   * Driven with plain BEGIN/COMMIT/ROLLBACK statements: an async body must
   * settle before the commit, and no synchronous transaction helper can wait
   * for it.
   */
  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN')
    try {
      const result = await fn(this)
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // A rollback failure must not mask the original error, which is the one
        // that explains what actually went wrong.
      }
      throw err
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

export interface OpenOptions {
  readonly?: boolean
  /** Enable WAL. Not meaningful for :memory:. */
  wal?: boolean
}

export function openNodeDb(filename: string, options: OpenOptions = {}): DbAdapter {
  const db = new DatabaseSync(filename, { readOnly: options.readonly === true })
  db.exec('PRAGMA foreign_keys = ON')
  if (options.wal === true && filename !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
  }
  return new NodeDbAdapter(db)
}

/** In-memory database, for tests and the harness. */
export function openMemoryDb(): DbAdapter {
  return openNodeDb(':memory:')
}
