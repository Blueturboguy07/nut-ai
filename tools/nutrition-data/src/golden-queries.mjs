#!/usr/bin/env node
/**
 * The golden-query suite.
 *
 * PLAN.md M0.5 exit criterion 3: a fixed set of queries must resolve to
 * known-correct rows, and the BUILD FAILS on regression.
 *
 * This is what stops a corpus rebuild from quietly degrading search. A build that
 * merely "completes" tells you nothing — the failure mode that matters is a
 * rebuild where every row is present but "chicken breast" stops matching, and
 * only a query-level assertion catches that.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB ?? join(HERE, '../../../apps/mobile/assets/nutrition.db')

/**
 * Each case asserts the SHAPE of a correct answer, not an exact row id — row ids
 * shift on every rebuild and asserting them would make this suite a nuisance
 * rather than a gate.
 */
const CASES = [
  { q: 'chicken breast', expect: /chicken/i, minHits: 1 },
  { q: 'chicken breast grilled', expect: /chicken/i, minHits: 1 },
  { q: 'banana raw', expect: /banana/i, minHits: 1 },
  { q: 'egg whole raw', expect: /egg/i, minHits: 1 },
  { q: 'rice white cooked', expect: /rice/i, minHits: 1 },
  { q: 'broccoli raw', expect: /broccoli/i, minHits: 1 },
  { q: 'milk whole', expect: /milk/i, minHits: 1 },
  { q: 'olive oil', expect: /olive/i, minHits: 1 },
  { q: 'cheddar cheese', expect: /cheddar/i, minHits: 1 },
  { q: 'almonds', expect: /almond/i, minHits: 1 },
  { q: 'salmon atlantic', expect: /salmon/i, minHits: 1 },
  { q: 'sweet potato', expect: /sweet potato/i, minHits: 1 },
  { q: 'black beans', expect: /bean/i, minHits: 1 },
  { q: 'spinach raw', expect: /spinach/i, minHits: 1 },
  { q: 'butter', expect: /butter/i, minHits: 1 },
  { q: 'oats', expect: /oat/i, minHits: 1 },
  { q: 'yogurt', expect: /yogurt/i, minHits: 1 },
  { q: 'peanut butter', expect: /peanut/i, minHits: 1 },
  { q: 'ground beef', expect: /beef/i, minHits: 1 },
  { q: 'avocado', expect: /avocado/i, minHits: 1 },
]

/** Plural stemming must happen in the tokenizer, never in app code. */
const STEMMING_CASES = [
  { plural: 'tomatoes', singular: 'tomato' },
  { plural: 'eggs', singular: 'egg' },
  { plural: 'potatoes', singular: 'potato' },
]

function match(db, query) {
  const expr = query.split(/\s+/).filter(Boolean).map((t) => `"${t}"`).join(' ')
  return db
    .prepare(
      `SELECT f.id, f.name, f.energy_kcal
       FROM food_fts JOIN foods f ON f.id = food_fts.rowid
       WHERE food_fts MATCH ? ORDER BY bm25(food_fts, 10.0, 8.0, 4.0) LIMIT 10`,
    )
    .all(expr)
}

const db = new DatabaseSync(DB_PATH, { readOnly: true })
let failures = 0
let checked = 0

console.log(`Golden queries against ${DB_PATH}\n`)

// --- Corpus sanity ---------------------------------------------------------
const counts = {
  foods: db.prepare('SELECT COUNT(*) c FROM foods').get().c,
  portions: db.prepare('SELECT COUNT(*) c FROM food_portions').get().c,
  withEnergy: db.prepare('SELECT COUNT(*) c FROM foods WHERE energy_kcal IS NOT NULL').get().c,
}
console.log(`  foods=${counts.foods}  portions=${counts.portions}  with-energy=${counts.withEnergy}`)

if (counts.foods < 5000) { console.error(`  FAIL: corpus too small (${counts.foods} < 5000)`); failures++ }
if (counts.withEnergy !== counts.foods) {
  console.error(`  FAIL: ${counts.foods - counts.withEnergy} rows lack energy — they cannot be logged`)
  failures++
}

// Every row must be per-100g. One row on a different basis silently corrupts
// every total computed from it.
const badBasis = db.prepare("SELECT COUNT(*) c FROM foods WHERE basis <> 'per_100g'").get().c
if (badBasis > 0) { console.error(`  FAIL: ${badBasis} rows are not per_100g`); failures++ }

// No food exceeds the real energy-density ceiling. NOT 900: USDA lists pure
// animal fats and fish oils at exactly 902 kcal/100g, applying a food-specific
// Atwater factor of 9.02 kcal/g rather than the rounded 9.
const impossible = db.prepare('SELECT COUNT(*) c FROM foods WHERE energy_kcal > 920').get().c
if (impossible > 0) {
  const worst = db.prepare('SELECT name, energy_kcal FROM foods WHERE energy_kcal > 920 ORDER BY energy_kcal DESC LIMIT 3').all()
  console.error(`  FAIL: ${impossible} rows exceed 920 kcal/100g:`, worst.map((w) => `${w.name} (${w.energy_kcal})`).join('; '))
  failures++
}

// --- Query resolution ------------------------------------------------------
console.log('\n  Query resolution:')
for (const c of CASES) {
  checked++
  const hits = match(db, c.q)
  const ok = hits.length >= c.minHits && hits.some((h) => c.expect.test(h.name))
  if (!ok) {
    console.error(`  FAIL  "${c.q}" -> ${hits.length} hits${hits[0] ? `, top: ${hits[0].name}` : ''}`)
    failures++
  } else {
    console.log(`  ok    "${c.q}" -> ${hits[0].name.slice(0, 58)}`)
  }
}

// --- Tokenizer behaviour ---------------------------------------------------
console.log('\n  Stemming (must be the tokenizer, not app code):')
for (const s of STEMMING_CASES) {
  checked++
  const p = match(db, s.plural)
  const g = match(db, s.singular)
  if (p.length === 0 || g.length === 0) {
    console.error(`  FAIL  "${s.plural}" ${p.length} hits / "${s.singular}" ${g.length} hits`)
    failures++
  } else {
    console.log(`  ok    "${s.plural}" and "${s.singular}" both resolve`)
  }
}

// --- Word order must need no handling --------------------------------------
console.log('\n  Word-order independence:')
for (const [a, b] of [['chicken breast raw', 'raw breast chicken'], ['olive oil', 'oil olive']]) {
  checked++
  const ra = match(db, a).map((r) => r.id).sort().join(',')
  const rb = match(db, b).map((r) => r.id).sort().join(',')
  if (ra !== rb || ra === '') {
    console.error(`  FAIL  "${a}" and "${b}" returned different sets`)
    failures++
  } else {
    console.log(`  ok    "${a}" === "${b}"`)
  }
}

// --- Portions --------------------------------------------------------------
console.log('\n  Portion weights:')
const portionCheck = db.prepare(`
  SELECT f.name, p.measure_unit, p.gram_weight
  FROM food_portions p JOIN foods f ON f.id = p.food_id
  WHERE f.name LIKE '%banana%' AND p.gram_weight BETWEEN 80 AND 200 LIMIT 3
`).all()
checked++
if (portionCheck.length === 0) {
  console.error('  FAIL  no plausible banana portion weight — the food_portion join is wrong')
  failures++
} else {
  console.log(`  ok    banana portion: ${portionCheck[0].gram_weight} g (${portionCheck[0].measure_unit})`)
}

db.close()

console.log(`\n${checked - failures}/${checked} passed`)
if (failures > 0) {
  console.error(`\n${failures} GOLDEN QUERY FAILURE(S) — build rejected.`)
  process.exit(1)
}
console.log('Corpus accepted.')
