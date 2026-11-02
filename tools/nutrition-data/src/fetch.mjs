#!/usr/bin/env node
/**
 * Downloads and extracts the USDA FoodData Central CSV sources that
 * build.mjs ingests.
 *
 * WHY THIS EXISTS: build.mjs used to require the user to hand-curl and
 * hand-unzip two dated USDA archives into /tmp/fdc themselves, following the
 * install guide. USDA re-cuts "Foundation Foods" roughly twice a year — the
 * release this project originally pinned (2025-04-24) has since been
 * superseded twice (2025-12-18, then 2026-04-30), each under a NEW dated
 * folder name. A user who followed a guide telling them to grab "the latest"
 * release got a folder name the build script didn't recognize, and saw:
 *
 *   BUILD FAILED
 *   FDC Foundation Foods 2025-04-24: missing food.csv at
 *   /tmp/fdc/FoodData_Central_foundation_food_csv_2025-04-24/food.csv
 *
 * ...because the file genuinely wasn't there — the user had (correctly)
 * downloaded 2025-12-18 or 2026-04-30 instead.
 *
 * This script removes the manual step entirely: `npm run data:build` calls
 * it automatically when a source is missing, so there is nothing left to
 * hand-copy a stale URL for. It is also runnable standalone as
 * `npm run data:fetch` to pre-warm the cache or retry a failed download.
 */

import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'

const execFileAsync = promisify(execFile)

/**
 * Where extracted CSV directories live and where zip downloads are cached.
 *
 * A real OS path on Windows, never the POSIX string: `/tmp/fdc` handed to
 * the unzip that Git for Windows puts on the PATH lands in MSYS's own /tmp
 * (the user's Temp folder), while Node reads `D:\tmp\fdc` — so the download
 * "succeeded" and the build then found nothing (windows-guide-smoke run
 * 41376403373, Nov 1 2026). macOS and Linux keep /tmp/fdc, so an existing
 * cache there is still found.
 */
export const FDC_DIR = process.env.FDC_DIR ?? (process.platform === 'win32' ? join(tmpdir(), 'fdc') : '/tmp/fdc')
const CACHE_DIR = join(FDC_DIR, '.cache')

/**
 * Known-good releases as of this writing. SR Legacy is a frozen dataset (USDA
 * has cut exactly one CSV release of it since 2018 and states no further
 * updates are planned) so it never drifts. Foundation Foods is re-cut ~2x/yr;
 * override FDC_FOUNDATION_RELEASE to pin an older or newer cut without
 * touching code. Check https://fdc.nal.usda.gov/download-datasets for the
 * current list if this default ever 404s.
 */
export const SOURCES = [
  {
    key: 'foundation',
    label: 'FDC Foundation Foods',
    prefix: 'FoodData_Central_foundation_food_csv_',
    release: process.env.FDC_FOUNDATION_RELEASE || '2026-04-30',
  },
  {
    key: 'sr_legacy',
    label: 'FDC SR Legacy',
    prefix: 'FoodData_Central_sr_legacy_food_csv_',
    release: process.env.FDC_SR_LEGACY_RELEASE || '2018-04',
  },
]

const urlFor = (source) => `https://fdc.nal.usda.gov/fdc-datasets/${source.prefix}${source.release}.zip`

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Find an already-extracted directory matching `prefix*` under FDC_DIR that actually has food.csv. */
export async function findExtracted(baseDir, prefix) {
  let entries
  try {
    entries = await readdir(baseDir, { withFileTypes: true })
  } catch {
    return { dirs: [], usable: null }
  }
  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith(prefix)).map((e) => e.name).sort()
  for (let i = dirs.length - 1; i >= 0; i--) {
    const candidate = join(baseDir, dirs[i])
    try {
      await stat(join(candidate, 'food.csv'))
      return { dirs, usable: candidate, usableName: dirs[i] }
    } catch {
      // this directory matched the prefix but has no food.csv — likely a
      // half-finished extraction. Keep looking at older matches, but report it.
    }
  }
  return { dirs, usable: null, usableName: null }
}

/**
 * Downloads `url` to `destPath` with retries and a basic integrity check
 * (correct zip magic bytes + non-trivial size — catches the common failure
 * mode of silently saving an HTML error/redirect page as if it were the zip).
 */
async function downloadWithRetry(url, destPath, { retries = 3 } = {}) {
  let lastErr
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`server returned HTTP ${res.status} ${res.statusText}`)
      await mkdir(join(destPath, '..'), { recursive: true })
      const tmpPath = `${destPath}.partial`
      await pipeline(res.body, createWriteStream(tmpPath))
      const { size } = await stat(tmpPath)
      if (size < 1024) throw new Error(`downloaded file is only ${size} bytes — that is an error page, not a zip`)
      const magic = await readMagic(tmpPath)
      if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
        throw new Error('downloaded file does not start with the zip signature (PK) — it is corrupt or not a zip')
      }
      const { rename } = await import('node:fs/promises')
      await rename(tmpPath, destPath)
      return
    } catch (err) {
      lastErr = err
      if (attempt < retries) {
        const waitMs = 1000 * attempt
        console.warn(`  download attempt ${attempt}/${retries} failed (${err.message}) — retrying in ${waitMs}ms`)
        await sleep(waitMs)
      }
    }
  }
  throw new Error(
    `Failed to download after ${retries} attempts:\n` +
      `  URL:   ${url}\n` +
      `  error: ${lastErr.message}\n\n` +
      `  This is usually a network issue or USDA temporarily down. You can also\n` +
      `  download that URL by hand in a browser and unzip it into ${FDC_DIR}, then\n` +
      `  re-run npm run data:build.`,
  )
}

async function readMagic(path) {
  const { open } = await import('node:fs/promises')
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(2)
    await fh.read(buf, 0, 2, 0)
    return buf
  } finally {
    await fh.close()
  }
}

/**
 * Extracts a zip cross-platform: `unzip` first on mac/linux with `tar` as
 * the fallback; on Windows the built-in `tar` (bsdtar, Windows 10+) first,
 * because an MSYS `unzip` from Git for Windows reads paths its own way.
 */
async function extractZip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true })
  const unzip = ['unzip', ['-o', '-q', zipPath, '-d', destDir]]
  const tar = ['tar', ['-xf', zipPath, '-C', destDir]]
  const attempts = process.platform === 'win32' ? [tar, unzip] : [unzip, tar]
  let lastErr
  for (const [cmd, args] of attempts) {
    try {
      await execFileAsync(cmd, args)
      return
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(
    `Could not extract ${zipPath} — neither "unzip" nor "tar" worked on this system.\n` +
      `  Extract it yourself into ${destDir} with any zip tool, then re-run npm run data:build.\n` +
      `  Underlying error: ${lastErr?.message ?? 'unknown'}`,
  )
}

/** Ensures `source` is present under FDC_DIR, downloading + extracting it if not. Returns the resolved directory. */
export async function ensureSource(source) {
  const found = await findExtracted(FDC_DIR, source.prefix)
  if (found.usable) return found.usable

  if (found.dirs.length > 0) {
    console.warn(
      `  ${source.label}: found ${found.dirs.join(', ')} but none contain food.csv (incomplete extraction) — re-downloading`,
    )
  }

  const url = urlFor(source)
  console.log(`  ${source.label}: downloading ${url}`)
  await mkdir(CACHE_DIR, { recursive: true })
  const zipPath = join(CACHE_DIR, `${source.prefix}${source.release}.zip`)
  await downloadWithRetry(url, zipPath)
  console.log(`  ${source.label}: extracting into ${FDC_DIR}`)
  await extractZip(zipPath, FDC_DIR)

  const after = await findExtracted(FDC_DIR, source.prefix)
  if (!after.usable) {
    throw new Error(
      `${source.label}: downloaded and extracted ${url} but still cannot find a ` +
        `${source.prefix}*/food.csv under ${FDC_DIR}. The archive's internal layout may have ` +
        `changed again — inspect ${zipPath} by hand.`,
    )
  }
  return after.usable
}

async function main() {
  console.log(`nutai-nutrition-data — fetching FDC sources into ${FDC_DIR}\n`)
  for (const source of SOURCES) {
    const dir = await ensureSource(source)
    console.log(`  ${source.label}: ready at ${dir}`)
  }
  console.log('\nAll sources present. Run npm run data:build next.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('\nFETCH FAILED\n')
    console.error(err.message)
    process.exit(1)
  })
}
