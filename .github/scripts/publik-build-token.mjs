#!/usr/bin/env node
// CI only: put the app token from the PUBLIK_APP_TOKEN secret into
// apps/mobile/publik-build.json for this build. The committed file stays the
// app's way of getting its token; this only makes the CI build use the newest
// one. It never prints the token: it says only whether it differs from the
// committed one.
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
const token = (process.env.PUBLIK_APP_TOKEN ?? '').trim()
const cfg = JSON.parse(readFileSync(file, 'utf8'))

if (!token) {
  console.log('publik-build: no PUBLIK_APP_TOKEN secret; the committed token stays.')
  process.exit(0)
}
if (!/^pat_[A-Za-z0-9_-]{8,200}$/.test(token)) {
  console.log('publik-build: the PUBLIK_APP_TOKEN secret does not have the form of an app token.')
  process.exit(1)
}
console.log(`publik-build: the secret is ${token === cfg.appToken ? 'the same as' : 'different from'} the committed token.`)
cfg.appToken = token
writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
