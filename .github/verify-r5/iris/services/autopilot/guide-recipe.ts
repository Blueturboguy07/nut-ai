//
// Runtime recipe derivation — turning a fetched publik guide into an
// `InstallRecipe` the autopilot runner can drive, so every app with a Windows
// branch is auto-installable without a hand-authored entry in `recipes.ts`.
//
// This is the Windows answer to the macOS autopilot running an `IrisGuideStep`
// directly (`GuideAutopilotRunner`): rather than interpret guide steps in the
// runner, the Windows runner keeps its reviewed `RecipeStep` schema and this
// module maps a guide branch onto it. The mapping is the whole point — it decides
// who does each step (Iris runs it, the reader handles it, or it self-completes)
// while preserving the guide's ids, titles, bodies, and verifier labels.
//
// Pure module (no Node/Electron), fully unit-tested against the fixtures under
// `tests/fixtures/guides/`.
//

import type {
  IrisGuide,
  IrisGuideBranch,
  IrisGuideStep,
  IrisStepWatch,
  IrisUnsupportedPair,
} from "./guide-model";
import { branchKeyFor } from "./guide-model";
import type {
  InstallRecipe,
  LaunchTarget,
  RecipeOutput,
  RecipePrerequisite,
  RecipeStep,
  StepCheck,
  StepWatch,
} from "./recipe";

/// Which branch of a guide to derive. `platform` is the reader's computer;
/// `target` names the phone for a mobile guide (absent for desktop/local-web,
/// which resolve against the `…:desktop` branch key).
export interface RecipeDerivationTarget {
  readonly platform: "windows" | "macos";
  readonly target?: "ios" | "android";
}

/// The result of asking a guide for a recipe. Unsupported is its OWN case — a
/// pair the guide itself declares cannot work (Windows + iPhone) is never a
/// recipe, it is an explanation shown instead of steps.
export type RecipeResolution =
  | { readonly kind: "recipe"; readonly recipe: InstallRecipe }
  | {
      readonly kind: "unsupported";
      readonly branchKey: string;
      readonly unsupported: IrisUnsupportedPair;
    }
  /// The guide has no branch for this platform/target at all.
  | { readonly kind: "noBranch"; readonly requestedBranchKey: string };

/// The branch-key convention the deep link uses: a desktop/local-web install is
/// `windows:desktop`, a phone install is `windows:android` / `windows:ios`.
export function branchKeyForTarget(target: RecipeDerivationTarget): string {
  return `${target.platform}:${target.target ?? "desktop"}`;
}

// ── Command shape (ported from macOS `GuideAutopilotCommandShape`) ─────────────

/// Dev servers and watchers never exit; a step that runs one must be marked
/// long-running so the runner starts it and moves on instead of waiting forever.
/// Ported literally from `GuideAutopilotCommandShape.holdsTheShellOpen` — keep it
/// a superset of the run-from-source script names any shipped guide uses.
const COMMANDS_THAT_HOLD_THE_SHELL_OPEN: readonly RegExp[] = [
  // `(\.cmd)?`: on Windows the guides spell these `npm.cmd run dev` / `pnpm.cmd dev`
  // (the .cmd shim is what PowerShell resolves), and without it every dev server
  // ran as a blocking command until the 15-minute ceiling killed it.
  /\b(npm|pnpm|yarn|bun)(\.cmd)?\s+(run\s+)?(start|dev|watch|serve|preview|app|electron)\b/i,
  /\bnext\s+dev\b/i,
  /(^|\s|\/)vite(\s|$)/i,
  /\bdocker\s+compose\s+up\b(?![^\n]*\s-d\b)/i,
  /\bpython3?\s+-m\s+http\.server\b/i,
  /\bcargo\s+run\b/i,
  /\bexpo\s+start\b/i,
  /\bflutter\s+run\b/i,
  /\brails\s+s(erver)?\b/i,
  /\btauri\s+dev\b/i,
];

export function commandHoldsTheShellOpen(command: string): boolean {
  return COMMANDS_THAT_HOLD_THE_SHELL_OPEN.some((pattern) => pattern.test(command));
}

// ── POSIX → PowerShell (the clone-step idiom) ──────────────────────────────────
//
// A guide's Windows branch is authored in PowerShell, but the idempotent-clone
// step is routinely left in the macOS branch's POSIX form —
//
//   cd ~
//   if [ ! -d App/.git ]; then
//   git clone https://…/App.git
//   fi
//
// — which is a hard PowerShell ParserError (`[ … ]`, `then`, `fi` are all
// invalid syntax, not missing commands), so NOTHING in the step runs, not even
// the `git clone`, and the deterministic "command not found" self-heal never
// fires (a ParserError matches none of its signatures). That strands the reader
// at the very step that copies the source onto the machine, across most of the
// source-build catalog. Rather than trust every guide author to hand-translate
// this one construct, the derivation rewrites it to PowerShell for the Windows
// command and keeps the ORIGINAL as the `posixCommand`, so Iris-on-a-Mac (the
// test host) still drives the shape zsh understands. A command with no POSIX test
// construct is left untouched, so the many already-cross-platform steps — and a
// guide later fixed to native PowerShell — pay nothing and are never corrupted.

/// Whether a command carries a POSIX shell construct PowerShell cannot parse (a
/// `[ -x … ]` file test, or a line that is a bare `then`/`fi`), so the Windows
/// branch would choke on it. Deliberately narrow: it does not fire on an ordinary
/// `pnpm.cmd install` or a PowerShell `if (!(Test-Path …)) { … }`.
export function commandNeedsPosixTranslation(command: string): boolean {
  if (/\[\s*!?\s*-[defsxLrwe]\s+\S/.test(command)) return true;
  return command.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed === "fi" || trimmed === "then";
  });
}

/// Rewrites the POSIX file-test / if-construct idiom to PowerShell. Handles the
/// exact shape the guides' clone step uses — `if [ ! -d X ]; then … fi`, with or
/// without a leading `cd ~` (valid in both shells) — mapping the `-d`/`-f`/`-e`/`-s`
/// existence tests to `Test-Path`. It leaves anything it does not recognise
/// alone; the caller only swaps the result in for a command that needs it, so an
/// unrecognised remnant is never worse than the untranslated original.
export function translatePosixShellToPowerShell(command: string): string {
  return command
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "fi") return "}";
      if (trimmed === "then") return "{";
      return line
        // `if [ ! -d X ]; then`  →  `if (-not (Test-Path X)) {`
        .replace(/\bif\s*\[\s*!\s*-[defsxLrwe]\s+([^\]\s]+)\s*\]\s*;?\s*(then\b)?/gi, "if (-not (Test-Path $1)) {")
        // `if [ -d X ]; then`    →  `if (Test-Path X) {`
        .replace(/\bif\s*\[\s*-[defsxLrwe]\s+([^\]\s]+)\s*\]\s*;?\s*(then\b)?/gi, "if (Test-Path $1) {");
    })
    .join("\n");
}

/// A guide command is "runnable" only when it is a non-blank string. A `terminal`
/// or `check` step with no command is prose (a guide's "open your shell"), which
/// maps to a self-completing `noop` step — matching macOS's nil-command → succeeded.
function hasRunnableCommand(step: IrisGuideStep): boolean {
  return step.command !== undefined && step.command.trim() !== "";
}

/// Whether the guide marked this step sensitive — a secret is entered or shown
/// while the step is open (a password piped into `wrangler secret put`, an API
/// key on screen). macOS refuses to autopilot-execute any such step
/// (`stepIsAutopilotExecutable` requires `watch.sensitive != true`) and drops it
/// to the reader's own terminal, so its stdout/stderr capture, its
/// `commandFinished` event, and the fix ladder's model never touch the secret.
/// The Windows derivation makes the same call: a sensitive command becomes a
/// reader-handled `manual` step, never a `command` Iris runs itself.
function stepIsSensitive(step: IrisGuideStep): boolean {
  return step.watch?.sensitive === true;
}

/// Appends winget's non-interactive agreement flags to any `winget install` line
/// that is missing them, so a fresh machine's first winget use cannot stall on
/// the interactive source/package Y/N prompt — a prompt the autopilot's hidden,
/// `-NonInteractive`, stdin-less PowerShell has no way to answer. This mirrors
/// `setup-detour.ts`'s `wingetInstallCommand`, which always carries the flags, and
/// closes the gap where a guide author wrote a bare `winget install` (e.g.
/// plantgpt's `install-rust`). Per line, so a multi-line command keeps its shape.
function normalizeWingetAgreements(command: string): string {
  return command
    .split("\n")
    .map((line) => {
      if (!/\bwinget\s+install\b/i.test(line)) return line;
      let normalized = line;
      if (!/--accept-source-agreements/i.test(normalized)) {
        normalized += " --accept-source-agreements";
      }
      if (!/--accept-package-agreements/i.test(normalized)) {
        normalized += " --accept-package-agreements";
      }
      return normalized;
    })
    .join("\n");
}

/// The reader-facing instruction for a sensitive command step Iris will NOT run
/// itself. It names what to do (the guide's own body) and shows the exact command
/// to type — including the folder to run it in, since Iris's shell never moved
/// there for this step — so the reader can run it in their own terminal where the
/// secret stays with them.
function sensitiveStepInstruction(step: IrisGuideStep, command: string): string {
  const parts: string[] = [];
  const body = step.body.trim();
  if (body.length > 0) parts.push(body);
  parts.push(
    "This step handles a secret, so run it yourself in your own terminal — " +
      "Iris won't type it or watch the screen. Then it will carry on.",
  );
  const folder = step.workingDirectory;
  if (folder !== undefined && folder !== "") {
    parts.push(`In ${folder}, run:\n${command}`);
  } else {
    parts.push(command);
  }
  return parts.join("\n\n");
}

// ── Step mapping ───────────────────────────────────────────────────────────────

/// Maps one guide step onto one recipe step. The kind decides who does it:
///   terminal/check with a command → `command` (Iris runs it)
///   terminal/check with no command → `noop` (self-completes)
///   open → `open` (auto-advances once opened)
///   permission/web/paste → the matching reader-handled kind
///   verify → `verify`, carrying the watch expectations for the watch-loop port
/// Ids, titles, bodies and verifier labels are preserved on every kind.
function recipeStepFromGuideStep(step: IrisGuideStep): RecipeStep {
  const shared = {
    id: step.id,
    title: step.title,
    body: step.body,
    ...(step.verifierLabel !== undefined ? { verifierLabel: step.verifierLabel } : {}),
    // Carry the guide's watch block through verbatim so the watch-loop port can
    // confirm the step from the reader's machine. The runner consults it for a
    // `verify` step, for an `open` step (a manual installer whose completion Iris
    // watches for — cargo on PATH, the page's visual state), and for a reader
    // step (sign_in/permission/web/paste/manual); a `command` step advances on
    // its own exit, so its watch is simply unused.
    ...(step.watch !== undefined && step.watch.expect.length > 0
      ? { watch: watchForRecipe(step.watch) }
      : {}),
  };

  switch (step.kind) {
    case "terminal":
    case "check": {
      if (!hasRunnableCommand(step)) {
        return { ...shared, kind: "noop" };
      }
      // The Windows command, with the POSIX clone-step idiom rewritten to
      // PowerShell so it does not ParserError on the shell Iris actually drives.
      // The original bash is kept as `posixCommand` for the Mac test host.
      const authoredCommand = normalizeWingetAgreements(step.command as string);
      const needsPosixTranslation = commandNeedsPosixTranslation(authoredCommand);
      const command = needsPosixTranslation
        ? translatePosixShellToPowerShell(authoredCommand)
        : authoredCommand;
      // A sensitive step is never run by Iris — it is handed to the reader, who
      // runs it in their own terminal so the secret never reaches Iris's shell,
      // its output capture, or the fix ladder's model. Faithful to macOS dropping
      // a `watch.sensitive` step to the manual branch. The command is embedded in
      // the instruction (never as a runnable `command` field, so no code path can
      // execute it), and any non-empty watch rides on `shared` so a pixel-free
      // side signal can still auto-advance it.
      if (stepIsSensitive(step)) {
        return {
          ...shared,
          kind: "manual",
          instruction: sensitiveStepInstruction(step, command),
        };
      }
      const check: StepCheck | undefined =
        step.tool !== undefined ? { type: "tool_version", tool: step.tool } : undefined;
      return {
        ...shared,
        kind: "command",
        command,
        // Only when the Windows command was translated: keep the authored bash so
        // Iris-on-a-Mac (the test host) still runs the shape zsh understands.
        ...(needsPosixTranslation ? { posixCommand: authoredCommand } : {}),
        ...(step.workingDirectory !== undefined && step.workingDirectory !== ""
          ? { workingDirectory: step.workingDirectory }
          : {}),
        ...(commandHoldsTheShellOpen(command) ? { longRunning: true } : {}),
        ...(check !== undefined ? { check } : {}),
      };
    }

    case "open":
      return {
        ...shared,
        kind: "open",
        ...(step.href !== undefined ? { href: step.href } : {}),
      };

    case "permission":
      return {
        ...shared,
        kind: "permission",
        instruction: step.body,
        ...(step.href !== undefined ? { href: step.href } : {}),
      };

    case "web":
      return {
        ...shared,
        kind: "web",
        instruction: step.body,
        ...(step.href !== undefined ? { href: step.href } : {}),
      };

    case "paste": {
      // Iris never types the SECRET a paste step moves — that invariant is
      // untouched, and it's why the step is still always handed to the
      // reader below. But a guide author can give the step a `command` whose
      // only job is opening the file being edited — chatmany's own guide
      // does exactly this (`notepad wrangler.toml` here, `open -e
      // wrangler.toml` on macOS) — and running that never touches the secret
      // value at all; it just saves the reader a filesystem hunt for a file
      // they were never told the path to. Dropping it unconditionally (the
      // previous behaviour) meant every guide using this idiom left the
      // reader staring at prose with nothing open and nowhere obvious to
      // look — reported directly against chatmany-mann's `set-db-id` step.
      // A sensitive step still never gets a command, exactly like
      // terminal/check.
      if (stepIsSensitive(step) || !hasRunnableCommand(step)) {
        return { ...shared, kind: "paste", instruction: step.body };
      }
      const authoredCommand = normalizeWingetAgreements(step.command as string);
      const needsPosixTranslation = commandNeedsPosixTranslation(authoredCommand);
      const command = needsPosixTranslation
        ? translatePosixShellToPowerShell(authoredCommand)
        : authoredCommand;
      return {
        ...shared,
        kind: "paste",
        instruction: step.body,
        command,
        ...(needsPosixTranslation ? { posixCommand: authoredCommand } : {}),
        ...(step.workingDirectory !== undefined && step.workingDirectory !== ""
          ? { workingDirectory: step.workingDirectory }
          : {}),
      };
    }

    case "verify":
      // The verify step's watch expectations rode in on `shared` above; here it
      // is just the kind. A verify step with no watch hands to the reader after
      // the bounded wait (the runner's behaviour), which is faithful to macOS.
      return { ...shared, kind: "verify" };
  }
}

/// Maps the guide model's watch block to the recipe's `StepWatch`. The two
/// expectation unions are the same shape; keeping `sensitive` and `expect`
/// explicit means a future divergence is caught by the compiler rather than
/// silently mis-carried.
function watchForRecipe(watch: IrisStepWatch): StepWatch {
  return {
    sensitive: watch.sensitive,
    expect: watch.expect.map((expectation) => expectation),
  };
}

// ── Prerequisites (setup steps) ────────────────────────────────────────────────

/// Carries a branch's `setupSteps` as recipe prerequisites for the setup-detour
/// port: the tool the reader needs, where to get it, or the command that installs
/// it. Preserves the setup step's id/title/body.
function prerequisitesFromBranch(branch: IrisGuideBranch): RecipePrerequisite[] {
  return branch.setupSteps.map((setupStep) => ({
    id: setupStep.id,
    title: setupStep.title,
    ...(setupStep.tool !== undefined ? { tool: setupStep.tool } : {}),
    ...(setupStep.href !== undefined ? { href: setupStep.href } : {}),
    ...(hasRunnableCommand(setupStep)
      ? { command: normalizeWingetAgreements(setupStep.command as string) }
      : {}),
    ...(setupStep.body !== "" ? { body: setupStep.body } : {}),
  }));
}

// ── Output / launch target ─────────────────────────────────────────────────────

/// The first localhost/127.0.0.1 URL a branch names — in an `open` step's href
/// first (the app the guide sends the reader to), then anywhere in a command.
/// This is the recipe's fallback local-web URL; the runner still overrides it with
/// the port a dev server actually served on (`detectServedUrl`).
function firstLocalWebUrl(branch: IrisGuideBranch): string | undefined {
  const localhostPattern = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/\S*)?/i;
  for (const step of branch.steps) {
    if (step.kind === "open" && step.href !== undefined) {
      const match = step.href.match(localhostPattern);
      if (match) return match[0];
    }
  }
  for (const step of branch.steps) {
    if (step.command !== undefined) {
      const match = step.command.match(localhostPattern);
      if (match) return match[0];
    }
  }
  // A local-web guide that never names a localhost URL (a Cloudflare Worker
  // deploy, a browser extension) still declares itself local-web; fall back to
  // the first `open` step's http(s) href, then to a plain localhost default.
  for (const step of branch.steps) {
    if (step.kind === "open" && step.href !== undefined && /^https?:\/\//i.test(step.href)) {
      return step.href;
    }
  }
  return undefined;
}

/// The Windows launch target for a desktop app, read from the guide's own
/// `Start-Process "<path>"` open-app step. The PowerShell `$env:NAME` token is
/// rewritten to the `%NAME%` form `app-inventory.ts`'s launcher expands. When no
/// such command exists (a guide whose "app" is a dev-server browser window), there
/// is no exe to launch and this returns undefined.
function launchTargetFromBranch(branch: IrisGuideBranch): LaunchTarget | undefined {
  // Search from the end: the launch command is near the finish of an install.
  for (let index = branch.steps.length - 1; index >= 0; index -= 1) {
    const command = branch.steps[index]?.command;
    if (command === undefined) continue;
    const match = command.match(/Start-Process\s+(?:-FilePath\s+)?["']([^"']+)["']/i);
    if (match) {
      const rawPath = match[1];
      const windowsEnvironmentPath = rawPath.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, "%$1%");
      return { via: "path", path: windowsEnvironmentPath };
    }
  }
  return undefined;
}

/// Chooses the recipe's output and how Iris opens it, from the guide's declared
/// `outputType` and the branch's steps. desktop_app resolves to an exe launch when
/// the guide launches one, otherwise a served URL when it names one, otherwise
/// nothing to auto-open; local_web resolves to the served URL; mobile_app has
/// nothing to open on the PC; credential produces a credential.
function outputForGuide(guide: IrisGuide, branch: IrisGuideBranch): RecipeOutput {
  switch (guide.outputType) {
    case "credential":
      return { type: "credential" };
    case "local_web": {
      const url = firstLocalWebUrl(branch) ?? "http://localhost";
      return { type: "local_web", url };
    }
    case "desktop_app": {
      const launch = launchTargetFromBranch(branch);
      if (launch !== undefined) return { type: "desktop_app", launch };
      const url = firstLocalWebUrl(branch);
      if (url !== undefined) return { type: "local_web", url };
      return { type: "none" };
    }
    case "mobile_app":
      // The app runs on the phone; there is nothing to open on the computer.
      return { type: "none" };
  }
}

// ── The recipe ────────────────────────────────────────────────────────────────

/// Whether any of a branch's derived commands clones a repo — the same test
/// `recipeClonesARepo` makes over a recipe, applied to the branch so the recipe's
/// provenance fields (`canonicalRepo`/`pinnedCommit`) are attached only to a
/// source-clone install, never to a signed download.
function branchClonesARepo(branch: IrisGuideBranch): boolean {
  return branch.steps.some((step) => step.command?.includes("git clone") ?? false);
}

/// Derives an `InstallRecipe` from one branch of a guide, or reports that the
/// branch is unsupported / absent. Never returns a recipe for an `unsupported`
/// branch — that pair is an explanation, not an install.
export function recipeFromGuide(guide: IrisGuide, target: RecipeDerivationTarget): RecipeResolution {
  const requestedBranchKey = branchKeyForTarget(target);
  const branch = guide.branches.find((candidate) => branchKeyFor(candidate) === requestedBranchKey);
  if (branch === undefined) {
    return { kind: "noBranch", requestedBranchKey };
  }
  if (branch.unsupported !== undefined) {
    return { kind: "unsupported", branchKey: requestedBranchKey, unsupported: branch.unsupported };
  }

  const steps = branch.steps.map((step) => recipeStepFromGuideStep(step));
  const clonesARepo = branchClonesARepo(branch);
  const canonicalRepo =
    clonesARepo && guide.sourceOwner !== "" && guide.sourceRepo !== ""
      ? `${guide.sourceOwner}/${guide.sourceRepo}`
      : undefined;
  const pinnedCommit = clonesARepo ? guide.sourceCommit : undefined;
  const prerequisites = prerequisitesFromBranch(branch);

  const recipe: InstallRecipe = {
    slug: guide.appSlug,
    appName: guide.appName,
    output: outputForGuide(guide, branch),
    ...(canonicalRepo !== undefined ? { canonicalRepo } : {}),
    ...(pinnedCommit !== undefined ? { pinnedCommit } : {}),
    ...(prerequisites.length > 0 ? { prerequisites } : {}),
    steps,
  };

  return { kind: "recipe", recipe };
}
