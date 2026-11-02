#!/usr/bin/env node
/**
 * Runs one publik guide command the way Iris for Windows runs it, so CI sees
 * what a reader's PC sees. A copy of iris-windows/src/main/powershell-session.ts
 * (wrapCommandScript, spawnEncoded, parseRun):
 *   - a fresh powershell.exe (Windows PowerShell 5.1) per command, spawned by
 *     Node, so nothing but the folder carries over from the step before;
 *   - PATH rebuilt from the registry (Machine + User) before the command; every
 *     other variable, JAVA_HOME included, is what this process has;
 *   - the command in its own `& { }` block, the exit code read back from a
 *     marker line, a missing marker counted as exit 1;
 *   - done on the child's 'close' event (every output pipe closed), not on
 *     'exit', and a deadline after which the tree is killed (Iris: 15 min).
 *
 * install-jdk.ps1, prepare-gradle.ps1, build-native.ps1, build-libraries.ps1
 * and run-android.ps1 beside this file are VERBATIM copies of the Windows
 * commands in publik lib/guides/nut-ai.ts (guide v16), one file per guide
 * step. Do not edit them here; copy them again from the guide.
 *
 * Usage: node run-like-iris.mjs <command-file> <working-directory> <log-file> [deadline-seconds] [linger-seconds]
 * linger-seconds is NOT Iris behavior, only a CI time saver for long
 * deadlines: once powershell.exe has exited, give up after that many seconds
 * without a 'close' and report the held pipe (exit 124), instead of waiting
 * out the whole deadline.
 * Exit code: the code Iris would record, or 124 when Iris would time out.
 * It also prints when Gradle's "BUILD SUCCESSFUL" / "BUILD FAILED" line came,
 * so a log shows how long the step stayed open after the build was done, and
 * writes the timings to <log-file>.timing.json.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [commandFile, cwd, logFile, deadlineSeconds = '900', lingerSeconds] = process.argv.slice(2)
if (!commandFile || !cwd || !logFile) {
  console.error('usage: node run-like-iris.mjs <command-file> <working-directory> <log-file> [deadline-seconds]')
  process.exit(2)
}
const command = readFileSync(commandFile, 'utf8')
const deadlineMs = Number(deadlineSeconds) * 1000

const CODE_MARKER = '__IRIS_CODE__:'
const CWD_MARKER = '__IRIS_CWD__:'
const psSingleQuote = (value) => `'${value.replace(/'/g, "''")}'`
const script = [
  "$ProgressPreference = 'SilentlyContinue'",
  "$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')",
  `Set-Location -LiteralPath ${psSingleQuote(cwd)}`,
  '$global:LASTEXITCODE = 0',
  `& { ${command} }`,
  '$__code = if ($LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif (-not $?) { 1 } else { 0 }',
  `Write-Output "${CWD_MARKER}$($ExecutionContext.SessionState.Path.CurrentLocation.Path)"`,
  `Write-Output "${CODE_MARKER}$__code"`,
  '',
].join('\n')
const encoded = Buffer.from(script, 'utf16le').toString('base64')

const started = Date.now()
const seconds = () => ((Date.now() - started) / 1000).toFixed(1)
const child = spawn(
  'powershell.exe',
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
  { windowsHide: true },
)
let stdout = ''
let stderr = ''
let exitedAt = null
let buildLineAt = null
const BUILD_LINE = /BUILD (SUCCESSFUL|FAILED)/
function noteBuildLine(chunk) {
  if (buildLineAt === null && BUILD_LINE.test(chunk)) buildLineAt = seconds()
}
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdout += chunk
  noteBuildLine(chunk)
  process.stdout.write(chunk)
})
child.stderr.on('data', (chunk) => {
  stderr += chunk
  noteBuildLine(chunk)
  process.stdout.write(chunk)
})
child.on('exit', (code) => {
  exitedAt = seconds()
  console.log(`\n--- powershell.exe exited (${code}) at ${exitedAt} s`)
  if (lingerSeconds) {
    setTimeout(() => {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      finish('lingered')
    }, Number(lingerSeconds) * 1000).unref()
  }
})

let settled = false
function finish(kind) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  let code
  const lines = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(CODE_MARKER)) {
      const parsed = Number.parseInt(line.slice(CODE_MARKER.length).trim(), 10)
      code = Number.isNaN(parsed) ? 1 : parsed
    } else if (!line.startsWith(CWD_MARKER)) {
      lines.push(line)
    }
  }
  writeFileSync(logFile, `${lines.join('\n')}\n${stderr}`.trim() + '\n')
  if (buildLineAt !== null) console.log(`--- Gradle's BUILD line came at ${buildLineAt} s`)
  const recordedCode = kind === 'timed_out' || kind === 'lingered' ? 124 : (code ?? 1)
  writeFileSync(
    `${logFile}.timing.json`,
    JSON.stringify({ recorded: recordedCode, kind, deadlineSeconds: Number(deadlineSeconds), exitedAt, buildLineAt, endedAt: seconds() }) + '\n',
  )
  if (kind === 'lingered') {
    console.log(
      `--- no 'close' within ${lingerSeconds} s after powershell.exe exited at ${exitedAt} s: a child process still holds ` +
        `the output pipe, so Iris would wait out its deadline and record timed_out (CI stopped waiting early)`,
    )
    process.exit(124)
  }
  if (kind === 'timed_out') {
    console.log(
      `--- Iris would record timed_out: no 'close' within ${deadlineSeconds} s` +
        (exitedAt ? ` although powershell.exe exited at ${exitedAt} s (a child process still holds its output pipe)` : ''),
    )
    process.exit(124)
  }
  const recorded = code ?? 1
  console.log(`--- 'close' at ${seconds()} s; Iris would record exit code ${recorded}`)
  process.exit(recorded)
}
const timer = setTimeout(() => {
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  finish('timed_out')
}, deadlineMs)
child.on('error', (error) => {
  console.log(`--- spawn failed: ${error.message}`)
  process.exit(1)
})
child.on('close', () => finish('closed'))
