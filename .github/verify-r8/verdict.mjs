// Reads results.jsonl from iris-drive.mts and judges each step. Exit 1 on any failure.
import { appendFileSync, readFileSync } from 'node:fs'

const rows = readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
const fail = []
const lines = ['| run | step | Iris outcome | exit | seconds | processes left | git status |', '|---|---|---|---|---|---|---|']
for (const r of rows) {
  const procs = (r.procs || []).map((p) => p.split(' ')[0]).join(', ') || '-'
  lines.push(`| ${r.label} | ${r.step} | ${r.kind} | ${r.exitCode ?? ''} | ${r.secs ?? ''} | ${procs} | ${r.gitStatus ? r.gitStatus.replace(/\r?\n/g, ' ; ') : 'clean'} |`)
  if (r.step === 'run-android') {
    if (r.kind !== 'failed' || !/No Android connected device found/.test(r.tail || '') || r.secs > 300) {
      fail.push(`${r.label} run-android (no phone): ${r.kind} after ${r.secs} s, expected a quick no-device failure`)
    }
    continue
  }
  if (r.kind !== 'succeeded') fail.push(`${r.label} ${r.step}: Iris records ${r.kind} (exit ${r.exitCode}) after ${r.secs} s`)
  if (r.secs > 900) fail.push(`${r.label} ${r.step}: ${r.secs} s, over Iris's 900 s`)
  if (r.gitStatus) fail.push(`${r.label} ${r.step}: ~/nut-ai is not clean afterwards: ${r.gitStatus.replace(/\r?\n/g, ' ; ')}`)
  const holders = (r.procs || []).filter((p) => /^(java\.exe|KotlinCompileDaemon|GradleDaemon|cmake\.exe|ninja\.exe|clang\S*|\S+\(expo\))\s/.test(p))
  if (holders.length) fail.push(`${r.label} ${r.step}: left running: ${holders.join(' ; ')}`)
}
for (const label of [...new Set(rows.map((r) => r.label))]) {
  const mine = rows.filter((r) => r.label === label && r.secs != null)
  const top = mine.slice().sort((a, b) => b.secs - a.secs)[0]
  const dep = mine.find((r) => r.step === 'dependencies')
  lines.push('', `${label}: longest step ${top?.step} ${top?.secs} s; dependencies (npm install) ${dep?.secs} s; total ${Math.round(mine.reduce((t, r) => t + r.secs, 0))} s`)
}
const out = [...lines, '', ...(fail.length ? fail.map((f) => `FAIL: ${f}`) : ['every step passed'])].join('\n')
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n')
process.exit(fail.length ? 1 : 0)
