// Blind verify r7: judge a returning reader's run (results.jsonl from iris-drive.mts) plus the git state after it.
import { readFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const [file, variant, nut] = process.argv.slice(2)
const pin = '3dff45971c6a52410bd7b2ba40a38e331bd04938'
const rows = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
const fail = []
const lines = [`returning reader (${variant})`, '| run | step | Iris outcome | exit | seconds | git status |', '|---|---|---|---|---|---|']
let afterPin = false
for (const r of rows) {
  lines.push(`| ${r.label} | ${r.step} | ${r.kind} | ${r.exitCode} | ${r.secs} | ${r.gitStatus ? r.gitStatus.replace(/\r?\n/g, ' ; ') : 'clean'} |`)
  if (r.step === 'pin-source') afterPin = true
  if (r.step === 'run-android') { if (r.kind !== 'failed' || !/No Android connected device found/.test(r.tail || '')) fail.push(`${r.label} run-android: ${r.kind}`); continue }
  if (r.kind !== 'succeeded') fail.push(`${r.label} ${r.step}: ${r.kind} (exit ${r.exitCode}) after ${r.secs} s: ${String(r.tail || '').slice(-300)}`)
  if (r.secs > 900) fail.push(`${r.label} ${r.step}: ${r.secs} s > 900`)
  if (afterPin && r.gitStatus) fail.push(`${r.label} ${r.step}: tree not clean: ${r.gitStatus.replace(/\r?\n/g, ' ; ')}`)
  const holders = (r.procs || []).filter((p) => /^(java\.exe|KotlinCompileDaemon|GradleDaemon|cmake\.exe|ninja\.exe|\S+\(expo\))\s/.test(p))
  if (holders.length) fail.push(`${r.label} ${r.step}: left running: ${holders.join(' ; ')}`)
}
const pins = rows.filter((r) => r.step === 'pin-source')
const savedMsg = (r) => /saved with git stash/.test(r.tail || '')
const git = (...a) => execFileSync('git', ['-C', nut, ...a], { encoding: 'utf8' }).trim()
const head = git('rev-parse', 'HEAD')
const stashes = git('stash', 'list').split(/\r?\n/).filter(Boolean)
lines.push('', `HEAD ${head}; stash entries: ${stashes.length} (${stashes.join(' | ')}); pin-source runs: ${pins.map((p) => `${p.label}:${p.kind}:${savedMsg(p) ? 'stashed' : 'no-stash'}`).join(', ')}`)
if (head !== pin) fail.push(`HEAD is ${head}, not the pin`)
const pre = Number(readFileSync(process.env.RUNNER_TEMP + '/pre-status.txt', 'utf8').trim())
const wantStash = pre > 0 ? 1 : 0
lines.push(`git status entries before the guide: ${pre}`)
if (variant === 'dirty' && pre === 0) fail.push('the dirty setup left a clean tree')
if (stashes.length !== wantStash) fail.push(`stash entries ${stashes.length}, expected ${wantStash}`)
if (pins.length < 2) fail.push('pin-source did not run twice')
if (pins[1] && savedMsg(pins[1])) fail.push('the second pin-source stashed again')
if (pins[0] && variant === 'dirty' && !savedMsg(pins[0])) fail.push('the first pin-source did not say it saved the changes')
if (variant === 'dirty') {
  const show = git('stash', 'show', '--include-untracked', '--name-only', 'stash@{0}')
  lines.push(`stash@{0} holds: ${show.replace(/\r?\n/g, ', ')}`)
  if (!/README\.md/.test(show) || !/my-notes\.txt/.test(show)) fail.push('the stash does not hold README.md and my-notes.txt')
}
if (variant === 'branch') {
  const want = readFileSync(process.env.RUNNER_TEMP + '/my-tweaks.sha', 'utf8').trim()
  const have = git('rev-parse', 'my-tweaks')
  lines.push(`branch my-tweaks: ${have} (want ${want})`)
  if (have !== want) fail.push('my-tweaks moved')
}
const out = [...lines, '', ...(fail.length ? fail.map((f) => 'FAIL: ' + f) : ['every check passed'])].join('\n')
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n')
process.exit(fail.length ? 1 : 0)
