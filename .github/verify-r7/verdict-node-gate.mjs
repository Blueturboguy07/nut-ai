// Blind verify r6: the guide's dependencies step on an unsupported Node must stop BEFORE npm install.
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
const rows = readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
const nm = process.argv[3]
const d = rows.find((r) => r.step === 'dependencies')
const fail = []
for (const r of rows) if (r.step !== 'dependencies' && r.kind !== 'succeeded') fail.push(`${r.step}: ${r.kind} (exit ${r.exitCode})`)
if (!d) fail.push('no dependencies row')
else {
  if (d.kind !== 'failed') fail.push(`dependencies: Iris records ${d.kind} (exit ${d.exitCode}), expected failed`)
  if (d.secs > 30) fail.push(`dependencies: ${d.secs} s, not an early stop`)
  if (!/Nut AI needs Node 22\.16\.0 or newer, and not Node 23\./.test(d.tail || '')) fail.push('dependencies: the Node message is missing')
}
const nmExists = existsSync(nm)
if (nmExists) fail.push(`${nm} exists: npm install ran`)
const out = `node gate: dependencies ${d?.kind} exit ${d?.exitCode} after ${d?.secs} s; node_modules ${nmExists ? 'EXISTS' : 'absent'}\n` + (fail.length ? fail.map((f) => 'FAIL: ' + f).join('\n') : 'stopped early, as intended')
console.log(out)
console.log('--- tail:\n' + (d?.tail || ''))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n')
process.exit(fail.length ? 1 : 0)
