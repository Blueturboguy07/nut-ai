#!/usr/bin/env node
/**
 * The nutrition-corpus build.
 *
 * PLAN.md M0.5 / SPEC-accuracy-engine.md §5.2. Ships the GENERIC tier first
 * (~15-25 MB) to unblock M1; branded and the national tables are additive stages
 * gated independently.
 *
 * THE RULE THAT MADE THIS STAGE RISKY: two prior research passes could not read
 * USDA's field-description PDF (it 403'd both times), so the column names of
 * `food_portion` and `measure_unit` were explicitly UNCONFIRMED. This build
 * therefore validates every header against the real CSV and FAILS LOUDLY on a
 * mismatch rather than silently producing a corpus with empty portion weights.
 *
 * Second rule: NULL never becomes 0. USDA's own disclaimer is explicit that a
 * missing value means data were not supplied, not that the amount is zero. A
 * fabricated zero is worse than an absent value because it looks like knowledge.
 */

import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { SOURCES, FDC_DIR, findExtracted, ensureSource } from './fetch.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../../..')

const OUT = process.env.OUT ?? join(REPO, 'apps/mobile/assets/nutrition.db')

/**
 * Resolves a source to its extracted directory, tolerating drift in the
 * dated folder name USDA bakes into each release (they re-cut Foundation
 * Foods ~2x/yr; the folder name always changes with it). Downloads and
 * extracts automatically via fetch.mjs if nothing usable is found yet.
 */
async function resolveSourceDir(source) {
  const found = await findExtracted(FDC_DIR, source.prefix)
  if (found.usable) {
    if (found.dirs.length > 1) {
      console.log(
        `  ${source.label}: multiple candidates under ${FDC_DIR} (${found.dirs.join(', ')}); using ${found.usableName}`,
      )
    }
    return found.usable
  }
  console.log(`  ${source.label}: not found under ${FDC_DIR} yet — fetching`)
  return ensureSource(source)
}

/**
 * Expected headers, verified against the real 2025-04-24 Foundation Foods and
 * 2018-04 SR Legacy releases. A build against assumed column names is exactly
 * the failure this constant exists to prevent.
 */
const EXPECTED_HEADERS = {
  'food.csv': ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'],
  'nutrient.csv': ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'],
  'food_nutrient.csv': ['id', 'fdc_id', 'nutrient_id', 'amount'],
  'food_portion.csv': [
    'id', 'fdc_id', 'seq_num', 'amount', 'measure_unit_id',
    'portion_description', 'modifier', 'gram_weight',
  ],
  'measure_unit.csv': ['id', 'name'],
}

/** FDC nutrient ids, verified present in nutrient.csv. */
const N = {
  energy_kcal: 1008,
  protein_g: 1003,
  fat_g: 1004,
  carb_g: 1005,
  fiber_g: 1079,
  sugar_g: 2000,
  sodium_mg: 1093,
  sat_fat_g: 1258,
}

// ---------------------------------------------------------------------------
// CSV reading. USDA's files are RFC4180 with quoted fields and embedded commas.
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

async function readCsv(path, onRow) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let header = null
  let count = 0
  for await (const line of rl) {
    if (line.trim() === '') continue
    const cells = parseCsvLine(line)
    if (!header) { header = cells.map((h) => h.trim()); continue }
    const row = {}
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i]
    onRow(row)
    count++
  }
  return { header, count }
}

async function validateHeader(path, file) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let first = null
  for await (const line of rl) { first = line; break }
  rl.close()
  if (!first) throw new Error(`${file}: empty file`)

  const actual = parseCsvLine(first).map((h) => h.trim())
  const expected = EXPECTED_HEADERS[file]
  const missing = expected.filter((c) => !actual.includes(c))

  if (missing.length > 0) {
    throw new Error(
      `HEADER MISMATCH in ${file}\n` +
        `  expected columns: ${expected.join(', ')}\n` +
        `  actual columns:   ${actual.join(', ')}\n` +
        `  MISSING:          ${missing.join(', ')}\n\n` +
        `  USDA changed this file's shape. Do NOT paper over it — every downstream\n` +
        `  gram weight and nutrient value depends on these names. Update\n` +
        `  EXPECTED_HEADERS only after confirming the new meaning of each column.`,
    )
  }
  return actual
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------

async function ingest(dir, sourceLabel, state) {
  const files = Object.keys(EXPECTED_HEADERS)
  for (const f of files) {
    const p = join(dir, f)
    try { await stat(p) } catch { throw new Error(`${sourceLabel}: missing ${f} at ${p}`) }
    await validateHeader(p, f)
  }
  console.log(`  ${sourceLabel}: all ${files.length} headers validated`)

  // Which fdc_ids belong to this tier. The Foundation download also carries
  // sample/acquisition rows that are NOT foods and must not become corpus rows.
  const keep = new Set()
  await readCsv(join(dir, 'food.csv'), (r) => {
    const dt = r.data_type
    if (dt === 'foundation_food' || dt === 'sr_legacy_food' || dt === 'survey_fndds_food') {
      const id = num(r.fdc_id)
      if (id != null) {
        keep.add(String(id))
        state.foods.set(String(id), {
          fdcId: String(id),
          source: dt === 'foundation_food' ? 'fdc_foundation'
                : dt === 'sr_legacy_food' ? 'fdc_sr_legacy' : 'fdc_fndds',
          name: r.description ?? '',
          publicationDate: r.publication_date ?? null,
          nutrients: {},
        })
      }
    }
  })
  console.log(`  ${sourceLabel}: ${keep.size} food rows`)

  const wanted = new Map(Object.entries(N).map(([k, v]) => [String(v), k]))
  let nutrientRows = 0
  await readCsv(join(dir, 'food_nutrient.csv'), (r) => {
    const fid = r.fdc_id
    if (!keep.has(fid)) return
    const field = wanted.get(r.nutrient_id)
    if (!field) return
    const amount = num(r.amount)
    // NULL stays NULL. A missing nutrient is not a zero nutrient.
    if (amount == null) return
    const f = state.foods.get(fid)
    if (f) { f.nutrients[field] = amount; nutrientRows++ }
  })
  console.log(`  ${sourceLabel}: ${nutrientRows} nutrient values`)

  const units = new Map()
  await readCsv(join(dir, 'measure_unit.csv'), (r) => units.set(r.id, r.name))

  let portions = 0
  await readCsv(join(dir, 'food_portion.csv'), (r) => {
    const fid = r.fdc_id
    if (!keep.has(fid)) return
    const grams = num(r.gram_weight)
    if (grams == null || grams <= 0) return
    state.portions.push({
      fdcId: fid,
      measureUnit: units.get(r.measure_unit_id) ?? r.portion_description ?? 'undetermined',
      modifier: r.modifier || null,
      amount: num(r.amount),
      gramWeight: grams,
      seqNum: num(r.seq_num) ?? 999,
    })
    portions++
  })
  console.log(`  ${sourceLabel}: ${portions} portion records`)
}

async function main() {
  console.log('nutai-nutrition-data — building the generic tier\n')

  const state = { foods: new Map(), portions: [] }

  const resolved = []
  for (const source of SOURCES) {
    const dir = await resolveSourceDir(source)
    const label = `${source.label} (${dir.split('/').pop()})`
    resolved.push({ label })
    console.log(`Ingesting ${label}`)
    await ingest(dir, label, state)
  }

  await mkdir(dirname(OUT), { recursive: true })
  // node:sqlite, built into Node 22.13+: no native module, no compiler, so
  // `npm install` on a fresh Windows PC no longer needs Visual Studio.
  const db = new DatabaseSync(OUT)
  db.exec('PRAGMA journal_mode = DELETE')
  // This build recreates the artifact from scratch on every run, including
  // re-runs against a nutrition.db a previous run already populated (a user
  // retrying `npm run data:build` after fixing an earlier failure is exactly
  // that case). food_portions.food_id REFERENCES foods(id), and node:sqlite
  // defaults `foreign_keys` ON — so on a second run `DROP TABLE foods` would
  // fail with "FOREIGN KEY constraint failed" because food_portions (which
  // still held rows referencing it) hadn't been dropped yet. FK enforcement
  // only matters for the app's live writes, not this one-shot rebuild, so it
  // is turned off for the DROP + rebuild.
  db.exec('PRAGMA foreign_keys = OFF')
  /** One transaction around a synchronous body; rolled back if it throws. */
  const transaction = (fn) => () => {
    db.exec('BEGIN')
    try {
      fn()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  db.exec('DROP TABLE IF EXISTS foods; DROP TABLE IF EXISTS food_portions; DROP TABLE IF EXISTS food_fts; DROP TABLE IF EXISTS food_fts_trigram; DROP TABLE IF EXISTS build_manifest; DROP TABLE IF EXISTS brands; DROP TABLE IF EXISTS food_micros; DROP TABLE IF EXISTS food_synonyms;')

  // Schema is imported from the app's own package so the artifact can never
  // drift from what the resolver queries.
  const { NUTRITION_SCHEMA, NUTRITION_FTS_SCHEMA } = await import(
    join(REPO, 'packages/db-adapter/src/schema.ts').replace(/\.ts$/, '.ts')
  ).catch(async () => {
    // The package ships TypeScript source; read the DDL out of it directly rather
    // than adding a build step to the data pipeline.
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(join(REPO, 'packages/db-adapter/src/schema.ts'), 'utf8')
    const grab = (name) => {
      const m = new RegExp(`export const ${name} = \`([\\s\\S]*?)\``).exec(src)
      if (!m) throw new Error(`could not extract ${name} from schema.ts`)
      return m[1]
    }
    return { NUTRITION_SCHEMA: grab('NUTRITION_SCHEMA'), NUTRITION_FTS_SCHEMA: grab('NUTRITION_FTS_SCHEMA') }
  })

  db.exec(NUTRITION_SCHEMA)
  db.exec(NUTRITION_FTS_SCHEMA)

  const insertFood = db.prepare(`
    INSERT INTO foods (id, source, source_id, name, basis, basis_confidence,
                       energy_kcal, protein_g, fat_g, sat_fat_g, carb_g, fiber_g,
                       sugar_g, sodium_mg, completeness_score, popularity_rank,
                       license, updated_at)
    VALUES (?, ?, ?, ?, 'per_100g', 'high', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CC0', ?)
  `)
  const insertFts = db.prepare('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)')
  const insertTri = db.prepare('INSERT INTO food_fts_trigram (rowid, name) VALUES (?,?)')
  const insertPortion = db.prepare(`
    INSERT INTO food_portions (food_id, measure_unit, modifier, amount, gram_weight, is_fndds_default)
    VALUES (?,?,?,?,?,?)
  `)

  const idMap = new Map()
  let rowId = 0
  const now = Date.now()

  const tx = transaction(() => {
    for (const f of state.foods.values()) {
      // Every FDC value is already per 100 g by definition of the dataset. No
      // conversion is applied, and none should be invented.
      const n = f.nutrients
      if (n.energy_kcal == null) continue // an energy-less row cannot be logged

      rowId++
      idMap.set(f.fdcId, rowId)

      const present = ['energy_kcal', 'protein_g', 'fat_g', 'carb_g'].filter((k) => n[k] != null).length
      const completeness = present / 4

      insertFood.run(
        rowId, f.source, f.fdcId, f.name,
        n.energy_kcal ?? null, n.protein_g ?? null, n.fat_g ?? null, n.sat_fat_g ?? null,
        n.carb_g ?? null, n.fiber_g ?? null, n.sugar_g ?? null, n.sodium_mg ?? null,
        completeness, rowId, now,
      )
      insertFts.run(rowId, f.name, '', '')
      insertTri.run(rowId, f.name)
    }

    for (const p of state.portions) {
      const fid = idMap.get(p.fdcId)
      if (!fid) continue
      insertPortion.run(fid, p.measureUnit, p.modifier, p.amount, p.gramWeight, p.seqNum === 1 ? 1 : 0)
    }
  })
  tx()

  const manifest = db.prepare('INSERT OR REPLACE INTO build_manifest (key, value) VALUES (?,?)')
  const counts = {
    foods: db.prepare('SELECT COUNT(*) c FROM foods').get().c,
    portions: db.prepare('SELECT COUNT(*) c FROM food_portions').get().c,
  }
  transaction(() => {
    manifest.run('tier', 'generic')
    manifest.run('sources', resolved.map((s) => s.label).join(' | '))
    manifest.run('licenses', 'CC0-1.0 (USDA FoodData Central)')
    manifest.run('attribution', 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.')
    manifest.run('food_count', String(counts.foods))
    manifest.run('portion_count', String(counts.portions))
    manifest.run('schema_version', '1')
    manifest.run('built_at', new Date(now).toISOString())
  })()

  db.exec('VACUUM')
  db.close()

  const size = (await stat(OUT)).size
  console.log('\nBuilt', OUT)
  console.log(`  foods:    ${counts.foods}`)
  console.log(`  portions: ${counts.portions}`)
  console.log(`  size:     ${(size / 1024 / 1024).toFixed(1)} MB`)
}

main().catch((err) => {
  console.error('\nBUILD FAILED\n')
  console.error(err.message)
  process.exit(1)
})
