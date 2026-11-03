// Blind verify r8: which JVM each Gradle build really ran in (init script ~/.gradle/init.d/blind-jvm.gradle),
// plus the saved JDK. Fails unless every build ran on Java 17-21 from the saved folder and the saved folder is a JDK.
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
const home = process.env.USERPROFILE || process.env.HOME
const out = []; const fail = []
const savedRaw = existsSync(join(home, '.nut-ai-java-home')) ? readFileSync(join(home, '.nut-ai-java-home'), 'utf8') : ''
const saved = savedRaw.replace(/^﻿/, '').split(/\r?\n/)[0]
out.push(`saved ~/.nut-ai-java-home: [${saved}] trailing backslash: ${/\\$/.test(saved)}; javac.exe: ${saved && existsSync(join(saved, 'bin', 'javac.exe'))}`)
if (!saved) fail.push('nothing saved')
else {
  if (/\\$/.test(saved)) fail.push('saved folder ends in a backslash')
  if (!existsSync(join(saved, 'bin', 'javac.exe'))) fail.push('saved folder has no javac.exe (not a JDK)')
}
const log = existsSync(join(home, 'blind-jvm.log')) ? readFileSync(join(home, 'blind-jvm.log'), 'utf8').split(/\r?\n/).filter(Boolean) : []
out.push(`Gradle builds logged by the init script: ${log.length}`)
for (const l of log) {
  out.push('  ' + l)
  const v = /java\.version=(\d+)/.exec(l)?.[1]
  const h = /java\.home=(.*?) tasks=/.exec(l)?.[1] ?? ''
  if (!v || Number(v) < 17 || Number(v) > 21) fail.push(`a build ran on Java ${v}: ${l}`)
  if (saved && h.replace(/[\\/]+$/, '').toLowerCase() !== saved.replace(/[\\/]+$/, '').toLowerCase()) fail.push(`a build ran in ${h}, not the saved ${saved}`)
}
if (log.length < Number(process.argv[2] || 7)) fail.push(`only ${log.length} Gradle builds logged, expected at least ${process.argv[2] || 7}`)
const text = [...out, ...(fail.length ? fail.map((f) => 'FAIL: ' + f) : ['every Gradle build ran on the saved JDK'])].join('\n')
console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n')
process.exit(fail.length ? 1 : 0)
