//
// The gate every command passes before the autopilot shell will run it.
//
// TRUST BOUNDARY — read this. The rest of iris-windows holds a hard invariant
// (see tool-versions.ts): "no part of a command is ever built from guide text;
// there is no escape hatch." The autopilot deliberately relaxes that invariant —
// it runs commands that come from a recipe — so this module is the compensating
// control, and the relaxation is bounded three ways:
//
//   1. Provenance is the real boundary. Recipe commands come only from reviewed,
//      version-pinned recipe modules in this repo (shipped, not fetched as text
//      from an arbitrary guide). Model-proposed fix commands (a later increment)
//      are marked `model_proposed_fix` and gated harder.
//   2. This gate refuses outright the handful of commands no tap can make
//      informed (piping a download into a shell, wiping a disk), waves through
//      the ordinary, and pauses the rest for one explicit reader tap.
//   3. `ApprovedCommand` is the only value the shell will run, and it is minted
//      only by the two functions here — "run an unassessed command" cannot be
//      expressed elsewhere in the code.
//
// It is a guardrail against mistakes, not a defence against an adversary; regexes
// over command text are defeatable by construction, which is exactly why opacity
// itself trips the gate for untrusted (model) commands. Ported from the macOS
// `GuideAutopilotRiskAssessment.swift`, adapted for PowerShell/winget.
//

/// Where a command came from, which decides whether the opacity rules apply.
export type Provenance = "vetted_recipe" | "model_proposed_fix";

/// The verdict, in words a reader can act on.
export type Risk =
  | { readonly tier: "runs_without_asking" }
  | { readonly tier: "needs_a_confirm_tap"; readonly reason: string }
  | { readonly tier: "refused_outright"; readonly reason: string };

/// A command that has been through the gate. The shell runs these and nothing
/// else. The private brand makes it un-forgeable: only the two mint functions
/// below can produce one, so no caller can hand the shell a raw string.
declare const approvedBrand: unique symbol;
export interface ApprovedCommand {
  readonly text: string;
  readonly [approvedBrand]: true;
}

function mint(text: string): ApprovedCommand {
  return { text } as ApprovedCommand;
}

interface Rule {
  readonly pattern: RegExp;
  readonly reason: string;
}

function rule(source: string, reason: string): Rule {
  return { pattern: new RegExp(source, "i"), reason };
}

// The catastrophe floor: refused EVEN under the autonomy grant. Whole-disk /
// whole-profile destruction that no install ever needs — keeping it absolute is
// what lets "Let Iris take control" be safe to grant once. A hallucinated
// model-proposed fix that reaches for one is stopped here with no tap.
const CATASTROPHE_RULES: readonly Rule[] = [
  // Wipe a disk.
  rule(String.raw`\bformat-volume\b`, "This reformats a disk."),
  rule(String.raw`\bformat\s+[a-z]:`, "This reformats a disk."),
  rule(String.raw`\bdiskpart\b[^\n]*\bclean\b`, "This erases a disk with diskpart."),
  rule(String.raw`\bclear-disk\b`, "This erases a disk."),
  // Delete the drive root or the whole profile.
  rule(
    String.raw`\bremove-item\b[^\n]*-recurse\b[^\n]*(([a-z]:\\?|\$env:userprofile|\$home|\$env:systemroot)\s*(\n|$|;|,))`,
    "This deletes the root of a drive or the whole user profile.",
  ),
  rule(
    String.raw`\brm\b[^\n]*\s-[a-z]*(rf|fr)[a-z]*\s+(/|/\*|~|~/|\$home)\s*(\n|$|;|&)`,
    "This deletes the root of the disk or the whole home folder.",
  ),
  // Delete a core branch of the machine hive. `reg delete HKCU\...` is a
  // confirm-tier registry edit (see `CONFIRM_RULES`); this floor catches only
  // the deletion of `HKLM` itself or one of its top-level hives (SYSTEM,
  // SOFTWARE, …) — bricking Windows — which no install ever needs. A deeper
  // subkey delete (`reg delete HKLM\SOFTWARE\SomeApp`) is NOT a root and stays
  // at the confirm tier, because the trailing `\SomeApp` is not the `\s|$|/`
  // this requires right after the hive.
  rule(
    String.raw`\breg\s+delete\s+(hklm|hkey_local_machine)(\\(system|software|sam|security|hardware|components|bcd\d*))?(\s|$|/)`,
    "This deletes a core branch of the Windows registry.",
  ),
  // Rewrite the boot configuration. `bcdedit /enum` is read-only and stays at
  // the confirm tier; the destructive verbs here can leave Windows unbootable,
  // which no app install has any reason to do.
  rule(
    String.raw`\bbcdedit\b[^\n]*/(delete|deletevalue|import|set)\b`,
    "This changes how Windows boots.",
  ),
];

// Refused WITHOUT the grant, but run WITH it: download-and-run one-liners
// (`irm … | iex`, DownloadString + Invoke-Expression, `curl … | sh`) cannot be
// read before they run, so without the grant no tap can make them informed. With
// the grant they run — that shape is how half of all prerequisites install, and
// refusing it is the biggest reason a package install used to bounce the reader
// out to a web page.
const DOWNLOAD_AND_RUN_RULES: readonly Rule[] = [
  rule(
    String.raw`\b(irm|iwr|invoke-restmethod|invoke-webrequest)\b[^\n|]*\|[^\n]*\b(iex|invoke-expression)\b`,
    "This downloads a script and runs it without anyone reading it first.",
  ),
  rule(
    String.raw`\bdownloadstring\b[^\n]*\|\s*(iex|invoke-expression)\b`,
    "This downloads a script and runs it without anyone reading it first.",
  ),
  rule(
    String.raw`\b(curl|wget)\b[^\n|]*\|[^\n]*\b(sh|bash|zsh)\b`,
    "This downloads a script and runs it without anyone reading it first.",
  ),
];

// Refused for a MODEL-PROPOSED FIX even under the autonomy grant. A vetted,
// pinned recipe may download-and-run a known installer under the grant (that is
// how rustup and scoop install), but a fix an untrusted model wrote is never
// allowed to reach out and run code, or to hide what it runs inside an encoded
// blob — the two shapes an adversary-shaped hallucination would use. These are
// checked before the grant short-circuit, so the grant that a reader gives a
// vetted install never launders a model's opaque command through.
const MODEL_HARD_REFUSAL_RULES: readonly Rule[] = [
  ...DOWNLOAD_AND_RUN_RULES,
  rule(
    String.raw`\bdownloadstring\b`,
    "A fix should never download code and run it.",
  ),
  rule(
    String.raw`-encodedcommand\b`,
    "This hides what it runs inside an encoded blob, so its effect can't be read.",
  ),
];

// Needs a confirm tap: administrator-adjacent, destructive, or writes outside
// the reader's own folders.
const CONFIRM_RULES: readonly Rule[] = [
  // Elevation.
  rule(String.raw`\bsudo\b`, "This runs as administrator."),
  rule(String.raw`\b-verb\s+runas\b`, "This relaunches a program as administrator."),
  rule(String.raw`\brunas\b`, "This runs a program as another user."),
  rule(String.raw`\bset-executionpolicy\b`, "This changes what scripts Windows will run."),
  rule(String.raw`\b(iex|invoke-expression)\b`, "This runs text as a program."),
  // Destructive.
  rule(String.raw`\bremove-item\b[^\n]*-recurse\b`, "This deletes a folder and everything in it."),
  rule(String.raw`\brm\s+-rf\b`, "This force-deletes a folder and everything in it."),
  rule(String.raw`\brmdir\b[^\n]*/s\b`, "This deletes a folder and everything in it."),
  rule(String.raw`\bdel\b[^\n]*/s\b`, "This deletes files recursively."),
  rule(String.raw`\bstop-process\b`, "This force-quits a running program."),
  rule(String.raw`\btaskkill\b[^\n]*/f\b`, "This force-quits a running program."),
  rule(String.raw`\bgit\s+reset\s+--hard\b`, "This throws away uncommitted changes."),
  rule(String.raw`\bgit\s+clean\s+-[a-z]*f`, "This deletes untracked files."),
  rule(String.raw`\bgit\s+push\b[^\n]*(--force\b|\s-f\b)`, "This overwrites remote history."),
  rule(String.raw`\b(winget|choco|scoop)\s+uninstall\b`, "This uninstalls software."),
  rule(
    String.raw`\bdocker\s+(rm|rmi|volume\s+rm|system\s+prune)\b`,
    "This deletes Docker containers, images, or volumes.",
  ),
  // System and account changes.
  rule(String.raw`\breg\s+(add|delete)\b`, "This edits the Windows registry."),
  rule(String.raw`\bnew-localuser\b`, "This creates a Windows user account."),
  rule(String.raw`\bnet\s+user\b`, "This changes a Windows user account."),
  rule(String.raw`\bnet\s+localgroup\b`, "This changes a Windows user group."),
  rule(String.raw`\b(new-service|sc\.exe|sc\s+create)\b`, "This installs a system-level background service."),
  rule(String.raw`\bbcdedit\b`, "This changes how Windows boots."),
  rule(String.raw`\bnetsh\b`, "This changes network settings."),
  // Writes into a system folder.
  rule(
    String.raw`\b(copy-item|move-item|out-file|set-content|new-item)\b[^\n]*\s(c:\\windows|c:\\program files|\$env:systemroot)`,
    "This changes files in a system folder.",
  ),
  rule(String.raw`>>?\s*/(usr|etc|bin|sbin)/`, "This writes into a system folder."),
];

// Opacity: a command whose effect cannot be read from its text. Applied only to
// model-proposed fixes — a reviewed recipe is trusted to use substitution the
// way real installers do. `$(( ))` arithmetic is exempt (it computes a number).
const OPACITY_RULES: readonly Rule[] = [
  rule(
    String.raw`\$\((?!\()`,
    "Part of this command is computed when it runs, so its effect can't be read from its text.",
  ),
  rule(
    "`",
    "Part of this command is computed when it runs, so its effect can't be read from its text.",
  ),
  rule(String.raw`\beval\b`, "This runs text as a program."),
  rule(String.raw`\b[&.]\s*\{`, "This runs a computed script block."),
];

function firstMatch(rules: readonly Rule[], command: string): string | undefined {
  for (const { pattern, reason } of rules) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  return undefined;
}

// ── The folder the command will run in ──────────────────────────────────────
//
// Every rule above is a pattern over command TEXT, and the text of a command
// does not say where it runs. Once a guide step can declare its own working
// directory that becomes a real hole: `Remove-Item -Recurse -Force .` is a
// tidy-up in the app folder and a catastrophe in `C:\Windows`, and the two are
// spelled identically. So the gate also judges the folder itself — refused even
// under the autonomy grant, the same as the catastrophe floor, because running
// ANYTHING with the current directory set to a system folder or a drive root is
// a class of danger the command text alone can't show. Mirrors the
// system-folder / `..`-escape refusal in macOS `GuideAutopilotRunner.moveInto`.

/// Rewrites a folder to a single lower-cased, backslash-separated form with the
/// environment references a system folder is usually spelled with expanded, so
/// one comparison catches `C:\Windows`, `%SystemRoot%`, and `$env:windir` alike.
function normalizeWindowsFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/g, "")
    .toLowerCase()
    .replace(/%systemroot%|%windir%|\$env:systemroot|\$env:windir/g, "c:\\windows")
    .replace(/%programfiles\(x86\)%|\$env:programfiles\(x86\)/g, "c:\\program files (x86)")
    .replace(/%programfiles%|\$env:programfiles/g, "c:\\program files")
    .replace(/%systemdrive%|\$env:systemdrive/g, "c:");
}

const SYSTEM_FOLDER_PREFIXES = ["c:\\windows", "c:\\program files (x86)", "c:\\program files"];

/// Whether a normalized path is a Windows system folder (or below one). A bare
/// drive root is handled separately by `looksLikeADriveRoot`.
function looksLikeASystemFolder(normalizedPath: string): boolean {
  return SYSTEM_FOLDER_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}\\`),
  );
}

/// Whether a normalized path is the very root of a drive (`c:` or `c:\`, which
/// normalizes to `c:`). Nothing an install writes belongs at a drive root.
function looksLikeADriveRoot(normalizedPath: string): boolean {
  return /^[a-z]:$/.test(normalizedPath);
}

/// The reason a step's declared working directory is refused outright, or
/// undefined when the folder is a fine place to run. Absolute: honored even
/// under the autonomy grant.
export function forbiddenWorkingDirectory(workingDirectory: string): string | undefined {
  const folder = workingDirectory.trim();
  if (folder === "") return undefined;
  // A relative path that climbs out of the guide's own folder via `..`. The
  // shell would resolve it against wherever it happens to be sitting, which is
  // exactly the folder confusion this whole section closes.
  if (folder.split(/[\\/]/).includes("..")) {
    return "This step would run in a folder reached by climbing out of the install folder.";
  }
  const normalized = normalizeWindowsFolder(folder);
  if (looksLikeADriveRoot(normalized)) {
    return "This step would run at the very root of a drive.";
  }
  if (looksLikeASystemFolder(normalized)) {
    return "This step would run inside a Windows system folder.";
  }
  return undefined;
}

/// Whether a folder is one this code will resolve relative command paths
/// against: a drive-rooted or `~`-rooted path with nothing in it a shell would
/// expand. A `$env:`-rooted folder is deliberately NOT resolved (the runner's
/// `isAPlainFolder` refuses it as a working directory anyway), matching the
/// macOS resolver, which only resolves against `~`- or `/`-rooted folders.
function isAResolvableFolder(folder: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(folder) || folder.startsWith("~");
}

/// Splits a drive- or `~`-rooted folder into its path components, keeping the
/// drive (`c:`) or `~` as the first, un-poppable component.
function folderComponents(folder: string): string[] {
  return normalizeWindowsFolder(folder).split(/[\\/]/).filter((part) => part.length > 0);
}

/// Resolves one relative path token against a folder, collapsing `.` and `..`.
/// Reports whether a `..` tried to climb past the drive/home root — a token that
/// escapes the folder tree entirely, which is refused regardless of where it
/// lands.
function resolveRelativePath(
  token: string,
  folder: string,
): { readonly resolved: string; readonly escaped: boolean } {
  const components = folderComponents(folder);
  let escaped = false;
  for (const piece of token.split(/[\\/]/)) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") {
      // Component 0 is the drive or `~`; popping it would climb off the tree.
      if (components.length > 1) {
        components.pop();
      } else {
        escaped = true;
      }
      continue;
    }
    components.push(piece.toLowerCase());
  }
  const resolved = components.join("\\");
  return { resolved, escaped };
}

/// Whether a token is a plain relative path we should resolve — not a flag
/// (`-x`, `/f`), not an already-rooted path (`c:\…`, `\…`, `~…`), and not
/// anything the shell would compute (`$…`, `%…`). Quotes and other punctuation
/// mean it is not a plain path and it is left alone (opacity rules already
/// question computed text).
function looksLikeARelativePathToken(token: string): boolean {
  if (token.length === 0) return false;
  const first = token[0]!;
  if (first === "-" || first === "/" || first === "\\" || first === "~" || first === "$" || first === "%") {
    return false;
  }
  if (/^[A-Za-z]:/.test(token)) return false; // drive-rooted
  return /^[A-Za-z0-9._\\/@+-]+$/.test(token);
}

// ── Resolving the command against the folder(s) it will really run in ────────
//
// Every rule above is a pattern over command TEXT, and the text alone does not
// say where a relative path lands. The declared working directory closes half
// of that (`forbiddenWorkingDirectory`), but a single PowerShell line can also
// move the shell itself: `Set-Location C:\Windows; Remove-Item -Recurse -Force .`
// declares an ordinary folder, embeds a `Set-Location` into a system one, and
// then destroys `.` — which resolves to `C:\Windows`, not the declared folder.
// Neither the declared-folder check nor a raw-text rule sees it.
//
// So, like macOS `commandAsItWillRun`/`renderingsToAssess`, the gate rewrites
// each relative path token as the shell will actually resolve it — and, because
// a `;`-chained PowerShell line is a Windows idiom the macOS zsh port never had
// to handle, it also TRACKS an embedded `Set-Location`/`cd` so tokens after one
// resolve against the folder that command moved into. FOR JUDGING ONLY: the
// approved command always carries the text as written, so a rendering this gets
// wrong can only ever cost an extra confirm tap, never change what runs.

/// The location cmdlets whose first path argument moves where later relative
/// paths in the same line resolve. `cd`/`chdir` are the aliases, `sl` the short
/// form, `pushd` the stack-push that also changes the current directory.
const DIRECTORY_CHANGE_PROGRAMS: ReadonlySet<string> = new Set([
  "set-location",
  "sl",
  "cd",
  "chdir",
  "pushd",
]);

type CommandPiece =
  | { readonly kind: "whitespace"; readonly text: string }
  | { readonly kind: "separator"; readonly text: string }
  | { readonly kind: "word"; readonly text: string };

/// Splits a command into runs of whitespace, command separators, and words —
/// keeping every character so a rebuilt rendering is byte-identical wherever no
/// token was resolved (which is what lets the caller dedupe raw vs. resolved).
/// Separators (`;`, `|`, `&`, `&&`, `||`, and the grouping braces/parens) are
/// split out even when they touch a word (`a;b`), because they end one command
/// and begin another — the next word is a program name, not an argument.
function tokenizeCommand(command: string): CommandPiece[] {
  const pieces: CommandPiece[] = [];
  const isSpace = (character: string): boolean => character === " " || character === "\t" || character === "\n" || character === "\r";
  const isSingleSeparator = (character: string): boolean =>
    character === ";" || character === "|" || character === "&" || character === "(" || character === ")" || character === "{" || character === "}";
  let index = 0;
  while (index < command.length) {
    const character = command[index]!;
    if (isSpace(character)) {
      let end = index + 1;
      while (end < command.length && isSpace(command[end]!)) end += 1;
      pieces.push({ kind: "whitespace", text: command.slice(index, end) });
      index = end;
      continue;
    }
    const twoCharacters = command.slice(index, index + 2);
    if (twoCharacters === "&&" || twoCharacters === "||") {
      pieces.push({ kind: "separator", text: twoCharacters });
      index += 2;
      continue;
    }
    if (isSingleSeparator(character)) {
      pieces.push({ kind: "separator", text: character });
      index += 1;
      continue;
    }
    let end = index;
    while (end < command.length && !isSpace(command[end]!) && !isSingleSeparator(command[end]!)) {
      if (command.slice(end, end + 2) === "&&" || command.slice(end, end + 2) === "||") break;
      end += 1;
    }
    pieces.push({ kind: "word", text: command.slice(index, end) });
    index = end;
  }
  return pieces;
}

/// The bare program name of a word (path prefix and a `.exe`/`.cmd`/… suffix
/// stripped, lower-cased), so `Set-Location`, `sl`, and `C:\Windows\System32\cd.exe`
/// are all recognised as directory-change programs.
function bareProgramName(word: string): string {
  const unquoted = word.replace(/^["']|["']$/g, "");
  const bare = unquoted.split(/[\\/]/).pop() ?? unquoted;
  return bare.replace(/\.(cmd|exe|bat|ps1|com)$/i, "").toLowerCase();
}

/// A flag, not a path argument — the token after a `Set-Location` that is a flag
/// (`-Path`) is skipped when looking for the folder it moves into.
function isFlagToken(token: string): boolean {
  return token.startsWith("-");
}

/// The folder a directory-change command moves into, given the folder it ran in.
/// Absolute (drive-rooted or `~`-rooted) targets replace the folder; a plain
/// relative target resolves against it; anything the shell would expand
/// (`$env:…`, `%…%`, a quoted or computed value) makes the new folder UNKNOWN
/// (undefined), so later relative tokens are left unresolved rather than guessed.
function nextFolderAfterDirectoryChange(token: string, folder: string | undefined): string | undefined {
  if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith("~")) return token;
  if (folder !== undefined && looksLikeARelativePathToken(token)) {
    return resolveRelativePath(token, folder).resolved;
  }
  return undefined;
}

/// Walks a command left to right, rewriting each relative path argument to how
/// the shell will resolve it (tracking embedded directory changes), and flagging
/// the first argument that lands somewhere nothing should be written — a drive
/// root, a Windows system folder, or off the tree entirely. Returns both the
/// resolved rendering (for the rule tables) and that forbidden reason (the
/// declared-folder floor's command-side twin).
function resolveCommandAgainstFolder(
  command: string,
  workingDirectory: string | undefined,
): { readonly rendering: string; readonly forbiddenReason: string | undefined } {
  let folder: string | undefined =
    workingDirectory !== undefined && isAResolvableFolder(workingDirectory) ? workingDirectory : undefined;
  let rendering = "";
  let forbiddenReason: string | undefined;
  let tokenIsProgramName = true;
  let currentProgramChangesDirectory = false;
  let directoryChangeTargetConsumed = false;

  for (const piece of tokenizeCommand(command)) {
    if (piece.kind === "whitespace") {
      rendering += piece.text;
      continue;
    }
    if (piece.kind === "separator") {
      rendering += piece.text;
      tokenIsProgramName = true;
      currentProgramChangesDirectory = false;
      directoryChangeTargetConsumed = false;
      continue;
    }
    const token = piece.text;
    if (tokenIsProgramName) {
      rendering += token;
      tokenIsProgramName = false;
      currentProgramChangesDirectory = DIRECTORY_CHANGE_PROGRAMS.has(bareProgramName(token));
      directoryChangeTargetConsumed = false;
      continue;
    }
    // An argument. Resolve it against the folder the shell is in AS THIS TOKEN
    // RUNS (which an earlier embedded `cd` in the same line may have moved).
    if (folder !== undefined && looksLikeARelativePathToken(token)) {
      const { resolved, escaped } = resolveRelativePath(token, folder);
      rendering += resolved;
      if (
        forbiddenReason === undefined &&
        (escaped || looksLikeADriveRoot(resolved) || looksLikeASystemFolder(resolved))
      ) {
        forbiddenReason = "This reaches out of the install folder into a system location.";
      }
    } else {
      rendering += token;
    }
    // The first non-flag argument after a directory-change program is the folder
    // it moves into; update `folder` so the rest of the line resolves there.
    if (currentProgramChangesDirectory && !directoryChangeTargetConsumed && !isFlagToken(token)) {
      directoryChangeTargetConsumed = true;
      folder = nextFolderAfterDirectoryChange(token, folder);
    }
  }
  return { rendering, forbiddenReason };
}

/// The first rendering (raw or resolved) any rule in the table matches. Checking
/// both is how a command whose danger is only visible once its relative paths are
/// resolved (`Remove-Item -Recurse -Force .` after `Set-Location C:\Windows`) is
/// caught by the same tables as the plainly-written form.
function firstMatchOverRenderings(rules: readonly Rule[], renderings: readonly string[]): string | undefined {
  for (const rendering of renderings) {
    const reason = firstMatch(rules, rendering);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

/// The reason a relative path in the command climbs out of the guide's folder
/// into a place nothing should be written — a drive root or a system folder —
/// or undefined when nothing in it does. An ordinary `npm ci` in an ordinary
/// folder pays nothing and can never be refused by mistake, because a token is
/// only refused when it actually RESOLVES to a forbidden place; the only tokens
/// that can, from a folder the declared-folder check already vetted, are a `..`
/// walk out of it or a token after an embedded `Set-Location`/`cd` into a system
/// one. Absolute: honored even under the grant, because a `..`-walk (or a
/// `cd`-walk) into `C:\Windows\System32` is the declared-folder version of the
/// catastrophe floor. `workingDirectory` may be undefined: an embedded absolute
/// `Set-Location` still establishes a base the rest of the line resolves against.
export function escapesIntoAForbiddenPlace(
  command: string,
  workingDirectory: string | undefined,
): string | undefined {
  return resolveCommandAgainstFolder(command, workingDirectory).forbiddenReason;
}

/// The inputs to the gate, when a caller has more than a provenance to give —
/// notably the folder the command will run in. `autonomyGranted` defaults to
/// false and `workingDirectory` to none, so an options object with just a
/// provenance behaves exactly like the positional form.
export interface AssessOptions {
  readonly provenance: Provenance;
  readonly autonomyGranted?: boolean;
  readonly workingDirectory?: string;
}

interface NormalizedOptions {
  readonly provenance: Provenance;
  readonly autonomyGranted: boolean;
  readonly workingDirectory: string | undefined;
}

/// Accepts either the original positional form (`provenance`, `autonomyGranted`)
/// or the richer options object, so every existing caller and test keeps
/// compiling and the folder-aware callers can pass a working directory.
function normalizeAssessArguments(
  provenanceOrOptions: Provenance | AssessOptions,
  autonomyGranted: boolean,
): NormalizedOptions {
  if (typeof provenanceOrOptions === "string") {
    return { provenance: provenanceOrOptions, autonomyGranted, workingDirectory: undefined };
  }
  return {
    provenance: provenanceOrOptions.provenance,
    autonomyGranted: provenanceOrOptions.autonomyGranted ?? false,
    workingDirectory: provenanceOrOptions.workingDirectory,
  };
}

/// The verdict for a command of a given provenance. When `autonomyGranted` is
/// true (the reader granted "Let Iris take control" once), everything that is
/// not refused-even-under-the-grant runs without asking — a per-command tap on a
/// vetted install is exactly the friction the grant removes. When it is false
/// (the default, and every existing caller/test), the original three-tier
/// behavior is unchanged.
///
/// Passing a `workingDirectory` (via the options form) also judges the folder
/// the command will run in: a system folder, a drive root, or a `..`-escape out
/// of the guide's own folder is refused outright, even under the grant — the
/// command text alone cannot show where it runs, so the folder is judged
/// separately. Mirrors macOS `GuideAutopilotRiskAssessment.assess(_:inWorkingDirectory:)`.
export function assess(command: string, provenance: Provenance, autonomyGranted?: boolean): Risk;
export function assess(command: string, options: AssessOptions): Risk;
export function assess(
  command: string,
  provenanceOrOptions: Provenance | AssessOptions,
  autonomyGranted = false,
): Risk {
  const { provenance, autonomyGranted: granted, workingDirectory } = normalizeAssessArguments(
    provenanceOrOptions,
    autonomyGranted,
  );

  // The command as written AND, when a folder resolves its relative paths to
  // something different, the command as the shell will really run it. Every
  // absolute rule below is checked against both, so danger that only shows once
  // `.`/`..` are resolved (a `Set-Location C:\Windows; Remove-Item …` line) is
  // caught by the same tables as the plainly-written form. The forbidden-folder
  // reason falls out of the same walk.
  const { rendering, forbiddenReason } = resolveCommandAgainstFolder(command, workingDirectory);
  const renderings = rendering === command ? [command] : [command, rendering];

  // The catastrophe floor is absolute — refused even under the grant.
  const catastrophe = firstMatchOverRenderings(CATASTROPHE_RULES, renderings);
  if (catastrophe !== undefined) {
    return { tier: "refused_outright", reason: catastrophe };
  }

  // The folder the command will run in — also absolute, for the same reason the
  // floor is: no consent makes running in `C:\Windows`, or a `..`-walk (or an
  // embedded `cd`-walk) into it, safe. Judged before the grant can wave anything
  // through. `forbiddenReason` covers the command's own relative paths even when
  // the step declared no folder (an embedded absolute `Set-Location` gives the
  // rest of the line a base); `forbiddenWorkingDirectory` covers the declared
  // folder itself.
  if (workingDirectory !== undefined) {
    const forbiddenFolder = forbiddenWorkingDirectory(workingDirectory);
    if (forbiddenFolder !== undefined) {
      return { tier: "refused_outright", reason: forbiddenFolder };
    }
  }
  if (forbiddenReason !== undefined) {
    return { tier: "refused_outright", reason: forbiddenReason };
  }

  // A model-proposed fix is judged for opacity BEFORE the grant short-circuit,
  // because the grant a reader gives a vetted install must never launder an
  // untrusted model's opaque or download-and-run command. Download-and-run and
  // encoded blobs are refused outright even under the grant; the softer opacity
  // shapes (`$(…)`, backticks) pause for a tap.
  if (provenance === "model_proposed_fix") {
    const hardRefusal = firstMatchOverRenderings(MODEL_HARD_REFUSAL_RULES, renderings);
    if (hardRefusal !== undefined) {
      return { tier: "refused_outright", reason: hardRefusal };
    }
    const opaque = firstMatchOverRenderings(OPACITY_RULES, renderings);
    if (opaque !== undefined) {
      return { tier: "needs_a_confirm_tap", reason: opaque };
    }
  }

  if (granted) {
    return { tier: "runs_without_asking" };
  }

  const downloadAndRun = firstMatchOverRenderings(DOWNLOAD_AND_RUN_RULES, renderings);
  if (downloadAndRun !== undefined) {
    return { tier: "refused_outright", reason: downloadAndRun };
  }
  const confirm = firstMatchOverRenderings(CONFIRM_RULES, renderings);
  if (confirm !== undefined) {
    return { tier: "needs_a_confirm_tap", reason: confirm };
  }
  return { tier: "runs_without_asking" };
}

/// Approves a command the gate waves through. Undefined for anything that needs
/// a tap or is refused — callers surface those, never force them through. Honors
/// the same autonomy grant and working directory `assess` does.
export function approve(command: string, provenance: Provenance, autonomyGranted?: boolean): ApprovedCommand | undefined;
export function approve(command: string, options: AssessOptions): ApprovedCommand | undefined;
export function approve(
  command: string,
  provenanceOrOptions: Provenance | AssessOptions,
  autonomyGranted = false,
): ApprovedCommand | undefined {
  const verdict =
    typeof provenanceOrOptions === "string"
      ? assess(command, provenanceOrOptions, autonomyGranted)
      : assess(command, provenanceOrOptions);
  return verdict.tier === "runs_without_asking" ? mint(command) : undefined;
}

/// Approves a confirm-tier command after the reader's explicit tap. Refused-tier
/// commands stay refused — no tap reaches them. The folder matters here too: the
/// tap was asked for on the command as it will run, so this must not re-assess
/// it more leniently than the ask did.
export function approveAfterAReaderTap(command: string, provenance: Provenance, autonomyGranted?: boolean): ApprovedCommand | undefined;
export function approveAfterAReaderTap(command: string, options: AssessOptions): ApprovedCommand | undefined;
export function approveAfterAReaderTap(
  command: string,
  provenanceOrOptions: Provenance | AssessOptions,
  autonomyGranted = false,
): ApprovedCommand | undefined {
  const tier = (typeof provenanceOrOptions === "string"
    ? assess(command, provenanceOrOptions, autonomyGranted)
    : assess(command, provenanceOrOptions)
  ).tier;
  return tier === "runs_without_asking" || tier === "needs_a_confirm_tap" ? mint(command) : undefined;
}
