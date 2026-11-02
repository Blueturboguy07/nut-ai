#!/usr/bin/env node
/**
 * Node-purity gate.
 *
 * PLAN.md §4.1: "Every `packages/*` module must remain importable in plain Node
 * with zero React Native surface. Enforce with a CI check that imports each
 * package in a bare Node script."
 *
 * This is not style enforcement. The eval harness (`eval/`) must import the REAL
 * gram engine and the REAL resolver and run them under Node against the golden
 * set. If any package acquires a React Native import — even transitively, even
 * in a type-only position that survives to runtime — the harness can only score
 * raw model output, which measures the wrong thing: the gram engine and resolver
 * sit between the model and the number the user sees, and are where much of the
 * accuracy lives.
 *
 * Two checks, because they catch different failures:
 *   1. Static  — scan source for forbidden import specifiers. Catches the mistake
 *                at the moment it is written, with a precise file:line.
 *   2. Runtime — actually `import()` each package's entry in this Node process.
 *                Catches transitive contamination through a dependency, which no
 *                amount of source scanning will find.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')

/**
 * Forbidden import prefixes. `react-native` covers `react-native/Libraries/...`
 * deep imports too. Expo modules are listed explicitly rather than by a broad
 * `expo` prefix so that a hypothetical pure-JS `expo-`-named utility could be
 * allowlisted deliberately rather than by accident.
 */
const FORBIDDEN_PREFIXES = [
  'react-native',
  'expo',
  '@expo/',
  '@react-navigation/',
  '@gorhom/',
  '@shopify/flash-list',
  '@shopify/react-native-skia',
  '@op-engineering/op-sqlite',
  '@kingstinct/react-native-healthkit',
]

/** Extensions we scan. */
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/
/** Directories we never descend into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '__snapshots__'])

/**
 * Matches static `import ... from 'x'`, `export ... from 'x'`, bare `import 'x'`,
 * dynamic `import('x')`, and `require('x')`. Deliberately regex-based rather than
 * AST-based: this must run before any build step and must not depend on the very
 * toolchain it is guarding.
 */
const IMPORT_RE =
  /(?:^|[\s;{}()])(?:import|export)\s+(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/gm

function isForbidden(specifier) {
  return FORBIDDEN_PREFIXES.find(
    (p) => specifier === p || specifier.startsWith(p.endsWith('/') ? p : `${p}/`),
  )
}

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(join(dir, entry.name))
    } else if (SOURCE_EXT.test(entry.name)) {
      yield join(dir, entry.name)
    }
  }
}

async function staticScan(packageDirs) {
  const violations = []

  for (const pkgDir of packageDirs) {
    for await (const file of walk(pkgDir)) {
      const text = await readFile(file, 'utf8')
      IMPORT_RE.lastIndex = 0
      let match
      while ((match = IMPORT_RE.exec(text)) !== null) {
        const specifier = match[1] ?? match[2]
        if (!specifier) continue
        const hit = isForbidden(specifier)
        if (!hit) continue
        const line = text.slice(0, match.index).split('\n').length
        violations.push({
          file: relative(ROOT, file),
          line,
          specifier,
          matched: hit,
        })
      }
    }
  }

  return violations
}

async function runtimeImport(packageDirs) {
  const failures = []

  for (const pkgDir of packageDirs) {
    const name = relative(PACKAGES_DIR, pkgDir)
    let manifest
    try {
      manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
    } catch {
      // A package directory with no manifest yet is scaffolding, not a failure.
      continue
    }

    // Prefer built output if present; fall back to the source entry. A package
    // that has never been built is skipped rather than failed, so this gate is
    // usable before the first `tsc --build`.
    const candidates = [manifest.main, manifest.module, manifest.exports?.['.']?.import]
      .filter((v) => typeof v === 'string')
      .map((v) => join(pkgDir, v))

    let entry = null
    for (const candidate of candidates) {
      try {
        await stat(candidate)
        entry = candidate
        break
      } catch {
        /* try next */
      }
    }
    if (!entry) continue

    try {
      await import(pathToFileURL(entry).href)
    } catch (err) {
      failures.push({ name, entry: relative(ROOT, entry), error: err.message })
    }
  }

  return failures
}

async function main() {
  let dirents
  try {
    dirents = await readdir(PACKAGES_DIR, { withFileTypes: true })
  } catch {
    console.log('node-purity: no packages/ directory yet — nothing to check.')
    return
  }

  const packageDirs = dirents
    .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
    .map((d) => join(PACKAGES_DIR, d.name))

  if (packageDirs.length === 0) {
    console.log('node-purity: no packages yet — nothing to check.')
    return
  }

  const violations = await staticScan(packageDirs)
  const failures = await runtimeImport(packageDirs)

  if (violations.length === 0 && failures.length === 0) {
    console.log(`node-purity: OK — ${packageDirs.length} package(s) are React-Native-free.`)
    return
  }

  if (violations.length > 0) {
    console.error('\nnode-purity: forbidden React Native / Expo imports in packages/*\n')
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  imports '${v.specifier}'  (matched rule: ${v.matched})`)
    }
    console.error(
      '\n  packages/* must be pure TypeScript. The eval harness imports these modules\n' +
        '  under plain Node — see PLAN.md §4.1. If you need platform behaviour here,\n' +
        '  put it behind an interface and implement it in apps/mobile.\n' +
        '  Storage specifically: use packages/db-adapter, which has both an\n' +
        '  expo-sqlite implementation and a node:sqlite one.\n',
    )
  }

  if (failures.length > 0) {
    console.error('\nnode-purity: package(s) failed to import under bare Node\n')
    for (const f of failures) {
      console.error(`  ${f.name}  (${f.entry})\n    ${f.error}`)
    }
    console.error(
      '\n  This usually means a TRANSITIVE dependency pulled in React Native.\n' +
        '  Static scanning cannot catch that — this is why the runtime check exists.\n',
    )
  }

  process.exit(1)
}

main().catch((err) => {
  console.error('node-purity: checker itself failed:', err)
  process.exit(1)
})
