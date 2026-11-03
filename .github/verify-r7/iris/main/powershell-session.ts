//
// The real PowerShell the autopilot runs approved commands in — the runtime
// implementation of `ShellSession` (src/services/autopilot/shell.ts).
//
// Design: one short-lived PowerShell per command, threading the working
// directory forward explicitly. This is more robust than a persistent REPL over
// a pipe (whose line-vs-EOF execution semantics vary by PowerShell version) and
// it stays deterministic: each command is wrapped so its script reports, on two
// marker lines, the exit code and the resulting current directory. `cd` inside a
// step therefore persists to the next step, which is what an install sequence
// (`git clone`, then `cd repo`, then `pnpm install`) needs.
//
// Only the working directory carries between steps, not shell variables/env —
// an acceptable v1 limit for reviewed recipes. This module lives in `main/`
// because it spawns processes; its pure parsing helpers are exported so the
// vitest suite can check them on any host. The end-to-end run against real
// PowerShell is exercised on CI's windows-latest runner.
//

import { spawn } from "node:child_process";

import type { ApprovedCommand } from "../services/autopilot/risk";
import {
  detectServedUrl,
  type CommandOutcome,
  type ShellSession,
} from "../services/autopilot/shell";

const CODE_MARKER = "__IRIS_CODE__:";
const CWD_MARKER = "__IRIS_CWD__:";
const MAX_OUTPUT = 8 * 1024;

/// Quotes a path as a PowerShell single-quoted string (doubling embedded quotes),
/// so a folder with spaces or apostrophes cannot break out of `Set-Location`.
export function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/// Rebuilds `$env:Path` from the machine and user `Path` values in the registry,
/// the live source of truth an installer writes to. Every command runs in a fresh
/// `powershell.exe` that inherits the Electron process's PATH — captured when Iris
/// launched, so blind to anything installed since (a winget/rustup/uv install the
/// autopilot just ran). Re-reading the registry per command is what lets the very
/// next step see the tool the last step installed, without restarting Iris. This
/// is the Windows answer to macOS's `reloadTheReadersEnvironmentIntoTheShell`.
export const REFRESH_PATH_FROM_REGISTRY =
  "$env:Path = " +
  "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + " +
  "[System.Environment]::GetEnvironmentVariable('Path','User')";

export const SILENCE_PROGRESS_RECORDS = "$ProgressPreference = 'SilentlyContinue'";

/// The script Iris wraps every command in: refresh PATH from the registry, pin
/// the location, run the command in its own block, then report the exit code and
/// the resulting location on marker lines the parser looks for.
export function wrapCommandScript(command: string, cwd: string): string {
  return [
    // `powershell.exe -NonInteractive` serialises every progress record
    // ("Preparing modules for first use.") to stderr as CLIXML when stderr is
    // a pipe, and that blob then lands in the reader's transcript on every
    // step. Progress is never useful here; silence it before anything runs.
    SILENCE_PROGRESS_RECORDS,
    REFRESH_PATH_FROM_REGISTRY,
    `Set-Location -LiteralPath ${psSingleQuote(cwd)}`,
    "$global:LASTEXITCODE = 0",
    `& { ${command} }`,
    "$__code = if ($LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif (-not $?) { 1 } else { 0 }",
    `Write-Output "${CWD_MARKER}$($ExecutionContext.SessionState.Path.CurrentLocation.Path)"`,
    `Write-Output "${CODE_MARKER}$__code"`,
    "",
  ].join("\n");
}

/// Encodes a script for `-EncodedCommand` (UTF-16LE base64), which sidesteps all
/// quoting when handing a multi-line script to PowerShell.
export function encodeForPowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export interface ParsedRun {
  readonly exitCode: number | undefined;
  readonly cwd: string | undefined;
  readonly output: string;
}

/// Pulls the exit code and resulting directory out of a completed run's stdout,
/// and returns everything else as the visible output (bounded, trimmed). The
/// marker lines themselves are stripped so they never show in the terminal.
export function parseRun(stdout: string, stderr: string): ParsedRun {
  let exitCode: number | undefined;
  let cwd: string | undefined;
  const outputLines: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (rawLine.startsWith(CODE_MARKER)) {
      const parsed = Number.parseInt(rawLine.slice(CODE_MARKER.length).trim(), 10);
      exitCode = Number.isNaN(parsed) ? 1 : parsed;
    } else if (rawLine.startsWith(CWD_MARKER)) {
      const value = rawLine.slice(CWD_MARKER.length).trim();
      cwd = value.length > 0 ? value : undefined;
    } else {
      outputLines.push(rawLine);
    }
  }

  const combined = `${outputLines.join("\n")}\n${stderr}`.trim();
  // The END of the output, not the start: a failed build prints its error last,
  // after pages of progress. Keeping the head lost exactly the line the reader
  // and the fix ladder needed (seen on a 5-minute `tauri build`).
  const output = combined.length > MAX_OUTPUT ? combined.slice(-MAX_OUTPUT) : combined;
  return { exitCode, cwd, output };
}

const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

interface Collected {
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnFailed: boolean;
}

export class PowerShellSession implements ShellSession {
  private cwd: string;
  // Long-running children (dev servers) kept alive for the app's lifetime and
  // killed on dispose so the runner does not leave orphans behind.
  private readonly servers: ReturnType<typeof spawn>[] = [];
  // The PowerShell running the current foreground command, tracked so the red
  // 'Stop' can kill it AND its whole tree (the winget/npm/build children it
  // spawned). Null between commands.
  private currentChild: ReturnType<typeof spawn> | null = null;

  constructor(startingDirectory: string = process.env.USERPROFILE ?? "C:\\") {
    this.cwd = startingDirectory;
  }

  currentDirectory(): string {
    return this.cwd;
  }

  async run(command: ApprovedCommand, deadlineMs: number): Promise<CommandOutcome> {
    const script = wrapCommandScript(command.text, this.cwd);
    const collected = await this.spawnEncoded(script, deadlineMs);
    if (collected === "timed_out") {
      return { kind: "timed_out" };
    }
    if (collected.spawnFailed) {
      return { kind: "session_failed" };
    }
    const parsed = parseRun(collected.stdout, collected.stderr);
    if (parsed.cwd !== undefined) {
      this.cwd = parsed.cwd;
    }
    const exitCode = parsed.exitCode ?? 1;
    return exitCode === 0
      ? { kind: "succeeded", output: parsed.output }
      : { kind: "failed", exitCode, output: parsed.output };
  }

  async runLongRunning(
    command: ApprovedCommand,
    readyMarker: string | undefined,
    graceMs: number,
  ): Promise<CommandOutcome> {
    // A dev server never exits. Start it in its own PowerShell pinned to the
    // current directory, then resolve as soon as its readiness marker appears —
    // or after the grace period — while leaving it running.
    const script = `${SILENCE_PROGRESS_RECORDS}\n${REFRESH_PATH_FROM_REGISTRY}\nSet-Location -LiteralPath ${psSingleQuote(this.cwd)}\n& { ${command.text} }\n`;
    const child = spawn("powershell.exe", [...POWERSHELL_ARGS, "-EncodedCommand", encodeForPowerShell(script)], {
      windowsHide: true,
    });
    this.servers.push(child);

    return new Promise<CommandOutcome>((resolve) => {
      let settled = false;
      let output = "";
      // The served URL is caught as it goes by: a dev server prints it once,
      // early, and the rolling tail below may have scrolled it away by the time
      // the grace period ends.
      let servedUrl: string | undefined;
      const done = (outcome: CommandOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };
      const succeed = (): void =>
        done({ kind: "succeeded", output, servedUrl: servedUrl ?? detectServedUrl(output) });
      const timer = setTimeout(succeed, graceMs);

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        servedUrl ??= detectServedUrl(chunk);
        // A rolling tail, so an early crash's last lines survive a chatty start.
        output = (output + chunk).slice(-MAX_OUTPUT);
        if (readyMarker !== undefined && (output.includes(readyMarker) || chunk.includes(readyMarker))) succeed();
      });
      child.on("error", () => done({ kind: "session_failed" }));
      // If the server exits on its own before it is ready, that is a failure to
      // start — surface it rather than reporting a server that isn't there.
      child.on("exit", (code) => done(code === 0 ? { kind: "succeeded", output } : { kind: "failed", exitCode: code ?? 1, output }));
    });
  }

  /// The red 'Stop': kill the running command's whole process tree, then any
  /// long-running dev servers. `taskkill /T` walks the tree from the PowerShell
  /// down to the `winget`/`npm`/build children it launched, which a bare
  /// `child.kill()` (a single SIGTERM to PowerShell) would orphan. Best-effort:
  /// a child that already exited makes `taskkill` a no-op.
  abort(): void {
    this.killTree(this.currentChild);
    this.currentChild = null;
    for (const server of this.servers) {
      this.killTree(server);
    }
    this.servers.length = 0;
  }

  private killTree(child: ReturnType<typeof spawn> | null): void {
    if (!child || child.pid === undefined) {
      return;
    }
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      // taskkill is missing or the pid is already gone — fall through to kill().
    }
    try {
      child.kill();
    } catch {
      // Already dead.
    }
  }

  /// Asked of the processes themselves: node sets `exitCode` the moment a
  /// child exits, so a server that died after `runLongRunning` resolved is
  /// visible here and nowhere else.
  longRunningStillAlive(): boolean {
    return this.servers.some((server) => server.exitCode === null && !server.killed);
  }

  dispose(): void {
    for (const server of this.servers) {
      server.kill();
    }
    this.servers.length = 0;
    this.currentChild = null;
  }

  private spawnEncoded(script: string, deadlineMs: number): Promise<Collected | "timed_out"> {
    return new Promise((resolve) => {
      const child = spawn("powershell.exe", [...POWERSHELL_ARGS, "-EncodedCommand", encodeForPowerShell(script)], {
        windowsHide: true,
      });
      this.currentChild = child;
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (value: Collected | "timed_out"): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.currentChild === child) {
          this.currentChild = null;
        }
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        // Kill the whole tree, not just the top PowerShell. A timed-out command
        // (including the setup detour's unattended `winget install`, which runs
        // under the 15-minute default deadline) has launched children —
        // winget/msiexec/the installer — that a bare `child.kill()` would orphan,
        // left waiting on input nobody will supply. The manual red-'Stop' path
        // already reaps the tree via `killTree`; the deadline path must too.
        this.killTree(child);
        finish("timed_out");
      }, deadlineMs);

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", () => finish({ stdout, stderr, spawnFailed: true }));
      child.on("close", () => finish({ stdout, stderr, spawnFailed: false }));
    });
  }
}
