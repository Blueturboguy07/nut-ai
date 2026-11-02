#!/usr/bin/env node
/**
 * Does this Node carry the SQLite the corpus build and the harness need?
 *
 * node:sqlite arrived unflagged in Node 22.13, and the resolver depends on
 * FTS5 with the trigram tokenizer being compiled into it. This answers both
 * in one line and exits 1 otherwise, so a reader (or CI) learns "wrong Node"
 * before `npm run data:build` says something less clear.
 */
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
const version = db.prepare('SELECT sqlite_version() AS v').get().v
db.exec('CREATE VIRTUAL TABLE probe USING fts5(x, tokenize="trigram")')
db.close()
console.log(`node:sqlite ok on Node ${process.versions.node}: SQLite ${version}, FTS5 trigram ok`)
