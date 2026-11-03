/**
 * Starts a command the way a GUI app (Iris's Electron main process, started
 * from Explorer) would own it: NO console attached (detached on Windows =
 * DETACHED_PROCESS, so each powershell.exe the driver starts gets its own
 * hidden console, as under Electron) and an environment built from the
 * registry (Machine + User variables, as Explorer hands them out), not the CI
 * runner's process environment. Output is piped back here and printed.
 *
 * Usage: node launch-like-electron.mjs <env.json> <exe> [args...]
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [envFile, exe, ...args] = process.argv.slice(2)
const env = JSON.parse(readFileSync(envFile, 'utf8'))
for (const k of ['STANDIN', 'DEADLINE_MS']) if (process.env[k]) env[k] = process.env[k]
const child = spawn(exe, args, { env, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.on('data', (d) => process.stdout.write(d))
child.stderr.on('data', (d) => process.stdout.write(d))
child.on('error', (e) => { console.log(`launch failed: ${e.message}`); process.exit(1) })
child.on('close', (code) => process.exit(code ?? 1))
