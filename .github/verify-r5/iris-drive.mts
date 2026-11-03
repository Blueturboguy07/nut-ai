/**
 * Blind verifier (Nov 2 2026): runs the publik Nut AI guide v16 Windows steps
 * through Iris for Windows 0.9.15's OWN code, not a re-written copy:
 *   - iris/services/autopilot/guide-recipe.ts: recipeFromGuide, which turns
 *     the guide into the recipe Iris runs (POSIX clone rewrite, winget flags,
 *     long-running detection), verbatim from tag iris-v0.9.15;
 *   - iris/main/powershell-session.ts: PowerShellSession, verbatim from the
 *     same tag (fresh powershell.exe per command, done on 'close', 15 min);
 *   - the step folder move is runner.ts's `Set-Location <folder>` with its
 *     30 s limit, and the command deadline is shell.ts DEFAULT_COMMAND_TIMEOUT_MS.
 * One session for the whole run, so the working directory threads through
 * the steps as in Iris.
 *
 * Usage: node --experimental-strip-types iris-drive.mts <guide.json> <results.jsonl> <label> <step-id>...
 * A step id `run-android@standin` runs run-android with its last line replaced
 * by the text in env STANDIN (CI has no phone).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { recipeFromGuide } from './iris/services/autopilot/guide-recipe.ts'
import { decodeIrisGuide } from './iris/services/autopilot/guide-model.ts'
import { PowerShellSession } from './iris/main/powershell-session.ts'
import { DEFAULT_COMMAND_TIMEOUT_MS } from './iris/services/autopilot/shell.ts'

const [guideFile, outFile, label, ...ids] = process.argv.slice(2)
// Iris decodes the route's JSON before deriving (guide-recipe-resolver.ts).
const guide = decodeIrisGuide(JSON.parse(readFileSync(guideFile, 'utf8')))
const resolution = recipeFromGuide(guide, { platform: 'windows', target: 'android' })
if (resolution.kind !== 'recipe') throw new Error(`no recipe: ${resolution.kind}`)
const steps = resolution.recipe.steps as any[]
const session = new PowerShellSession(process.env.USERPROFILE)
const home = process.env.USERPROFILE as string
const deadline = Number(process.env.DEADLINE_MS || DEFAULT_COMMAND_TIMEOUT_MS)

function processes(): string[] {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(java|adb|node|cmake|ninja|clang.*|aapt2|hermesc)\\.exe$' } | ForEach-Object { $k = $_.Name; $c = [string]$_.CommandLine; if ($c -match 'KotlinCompileDaemon') { $k = 'KotlinCompileDaemon' } elseif ($c -match 'GradleDaemon') { $k = 'GradleDaemon' } elseif ($c -match 'metro|expo') { $k = $k + '(expo)' }; $k + ' ' + $_.ProcessId + ' parent ' + $_.ParentProcessId }"], { encoding: 'utf8' })
  return (r.stdout || '').split(/\r?\n/).filter(Boolean)
}
function gitStatus(): string {
  if (!existsSync(`${home}\\nut-ai\\.git`)) return ''
  const r = spawnSync('git', ['-C', `${home}\\nut-ai`, 'status', '--porcelain'], { encoding: 'utf8' })
  return r.status === 0 ? (r.stdout || '').trim() : `(git status exit ${r.status})`
}

let failed = 0
for (const raw of ids) {
  const [id, variant] = raw.split('@')
  const step = steps.find((s) => s.id === id)
  if (!step) { console.log(`### ${raw}: not in the recipe`); failed++; continue }
  if (step.kind !== 'command') { console.log(`### ${raw}: kind ${step.kind}, Iris runs nothing`); continue }
  let command: string = step.command
  if (variant === 'standin') {
    const lines = command.split('\n')
    lines[lines.length - 1] = process.env.STANDIN as string
    command = lines.join('\n')
  }
  console.log(`\n### ${label} ${raw} (folder ${step.workingDirectory ?? '(none)'}, longRunning ${!!step.longRunning})`)
  if (step.workingDirectory) {
    const moved = await session.run({ text: `Set-Location ${step.workingDirectory}` } as any, 30_000)
    if (moved.kind !== 'succeeded') {
      console.log(`--- could not move into ${step.workingDirectory}: ${JSON.stringify(moved).slice(0, 400)}`)
      appendFileSync(outFile, JSON.stringify({ label, step: raw, kind: 'blocked-folder' }) + '\n')
      failed++
      continue
    }
  }
  const t0 = Date.now()
  const outcome: any = step.longRunning
    ? await session.runLongRunning({ text: command } as any, step.readyWhen, 90_000)
    : await session.run({ text: command } as any, deadline)
  const secs = Math.round((Date.now() - t0) / 100) / 10
  const output: string = outcome.output ?? ''
  const exitCode = outcome.kind === 'succeeded' ? 0 : outcome.kind === 'failed' ? outcome.exitCode : outcome.kind === 'timed_out' ? 124 : -1
  const procs = processes()
  const status = gitStatus()
  console.log(output.slice(-3000))
  console.log(`--- ${label} ${raw}: Iris outcome ${outcome.kind} (exit ${exitCode}) after ${secs} s; cwd now ${session.currentDirectory()}`)
  console.log(`--- processes left: ${procs.length}\n${procs.map((p) => '    ' + p).join('\n')}`)
  console.log(`--- git status --porcelain in ~/nut-ai: ${status === '' ? '(clean)' : '\n' + status}`)
  appendFileSync(outFile, JSON.stringify({ label, step: raw, kind: outcome.kind, exitCode, secs, longRunning: !!step.longRunning, procs, gitStatus: status, tail: output.slice(-600) }) + '\n')
}
process.exit(0)
