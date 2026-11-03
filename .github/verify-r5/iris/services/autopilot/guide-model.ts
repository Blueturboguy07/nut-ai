//
// The strict-typed shape of a guide as `GET /api/iris/guides/{slug}` serves it,
// and a total, lenient decoder for it.
//
// This mirrors `iris-macos/leanring-buddy/IrisGuideModels.swift` field for field
// (which itself mirrors `publik/lib/iris-guides.ts`), so the two desktop clients
// read the same wire the same way. The decoder follows the SAME lenient rules the
// Swift `init(from:)` decoders follow:
//
//   - An unknown step `kind` falls back to `terminal` (Swift's `?? .terminal`).
//   - An unknown step expectation `type` is DROPPED, not fatal — a newer website
//     teaching Iris a signal an older client cannot evaluate costs that client
//     one signal, not the whole step (Swift's `LenientlyDecodedStepExpectation`).
//   - An unknown `shell` falls back to `terminal`.
//   - Extra fields are ignored, never fatal.
//
// It goes further than Swift in one deliberate way: the decoder is TOTAL — it
// never throws. Where Swift would throw on a missing required scalar, this coerces
// to a safe default (a missing title/body becomes `""`, a step with no usable
// `id` is dropped, a branch whose `platform` is neither `macos` nor `windows` is
// dropped). The autopilot must degrade to "this guide has no Windows steps"
// rather than crash a shell-driving run on one malformed field, and the resolver
// falls back to a built-in recipe when a decode yields nothing usable.
//
// Pure module (no Node/Electron), so the whole thing runs in the vitest suite.
//

/// The computer a branch targets.
export type IrisPlatform = "macos" | "windows";

/// The phone a mobile branch targets. Desktop/local-web branches carry none.
export type IrisMobileTarget = "ios" | "android";

/// Whether the route serves this guide. Only `pilot`/`approved` are published.
export type IrisGuideStatus = "pilot" | "approved" | "review";

/// What a step asks of the reader or of Iris. An unknown value decodes to
/// `terminal`, matching the Swift and Tauri clients.
export type IrisStepKind =
  | "check"
  | "terminal"
  | "open"
  | "permission"
  | "verify"
  | "web"
  | "paste";

export type IrisGuideShell = "terminal" | "powershell";

export type IrisGuideOutputType = "desktop_app" | "local_web" | "mobile_app" | "credential";

/// The only two tools a step can ask Iris to verify for the reader.
export type IrisStepTool = "git" | "node";

/// Why a computer/phone pair has no install route, shown instead of steps.
export interface IrisUnsupportedPair {
  readonly headline: string;
  readonly reason: string;
  readonly alternatives: readonly string[];
}

/// How the desktop app can tell, without being told, that a step is done. An
/// expectation whose `type` this build does not recognize is dropped by the
/// decoder rather than carried as a broken value.
export type IrisStepExpectation =
  | { readonly type: "foregroundApp"; readonly bundleId: string }
  | { readonly type: "urlHost"; readonly host: string }
  | { readonly type: "toolVersion"; readonly tool: string }
  | { readonly type: "axElement"; readonly roleLabel: string }
  | { readonly type: "visual"; readonly prompt: string };

/// Where the eye should fly while a step is open — text a person would use.
export interface IrisStepPointTarget {
  readonly descriptor: string;
  readonly inApp?: string;
  readonly isWindow?: boolean;
}

/// What a step tells the desktop app to watch for.
export interface IrisStepWatch {
  readonly expect: readonly IrisStepExpectation[];
  /// The screen during this step may contain something the reader would not want
  /// captured. Absent means not sensitive; a malformed value is read cautiously
  /// as sensitive (anything not explicitly `false`), matching Swift.
  readonly sensitive: boolean;
  readonly hints: readonly string[];
}

export interface IrisGuideStep {
  readonly id: string;
  readonly kind: IrisStepKind;
  readonly title: string;
  readonly body: string;
  readonly tool?: IrisStepTool;
  readonly command?: string;
  readonly href?: string;
  readonly actionLabel?: string;
  readonly verifierLabel?: string;
  readonly watch?: IrisStepWatch;
  readonly point?: IrisStepPointTarget;
  readonly workingDirectory?: string;
}

export interface IrisGuideBranch {
  readonly platform: IrisPlatform;
  /// Null for desktop and local-web branches, where the computer is the target.
  readonly target?: IrisMobileTarget;
  readonly label: string;
  readonly shell: IrisGuideShell;
  readonly setupSteps: readonly IrisGuideStep[];
  readonly steps: readonly IrisGuideStep[];
  /// When set, this pair cannot work and the branch carries no runnable steps.
  readonly unsupported?: IrisUnsupportedPair;
}

export interface IrisGuide {
  readonly appSlug: string;
  readonly appName: string;
  readonly version: number;
  readonly status: IrisGuideStatus;
  readonly sourceOwner: string;
  readonly sourceRepo: string;
  readonly sourceCommit?: string;
  readonly outputType: IrisGuideOutputType;
  readonly estimatedMinutes?: number;
  readonly readmeSectionIds: readonly string[];
  readonly reviewNote?: string;
  readonly branches: readonly IrisGuideBranch[];
}

// ── Decoding helpers (total: every one has a safe answer for a bad value) ──────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const KNOWN_STEP_KINDS: ReadonlySet<string> = new Set([
  "check",
  "terminal",
  "open",
  "permission",
  "verify",
  "web",
  "paste",
]);

function decodeStepKind(value: unknown): IrisStepKind {
  // An unknown kind falls back to `terminal`, exactly like the Swift and Tauri
  // clients — losing one step's styling beats a reader seeing no guide at all.
  const candidate = asString(value);
  return candidate !== undefined && KNOWN_STEP_KINDS.has(candidate)
    ? (candidate as IrisStepKind)
    : "terminal";
}

function decodeShell(value: unknown): IrisGuideShell {
  return value === "powershell" ? "powershell" : "terminal";
}

function decodeTool(value: unknown): IrisStepTool | undefined {
  return value === "git" || value === "node" ? value : undefined;
}

function decodeExpectation(value: unknown): IrisStepExpectation | undefined {
  const record = asRecord(value);
  switch (record.type) {
    case "foregroundApp": {
      const bundleId = asString(record.bundleId);
      return bundleId !== undefined ? { type: "foregroundApp", bundleId } : undefined;
    }
    case "urlHost": {
      const host = asString(record.host);
      return host !== undefined ? { type: "urlHost", host } : undefined;
    }
    case "toolVersion": {
      const tool = asString(record.tool);
      return tool !== undefined ? { type: "toolVersion", tool } : undefined;
    }
    case "axElement": {
      const roleLabel = asString(record.roleLabel);
      return roleLabel !== undefined ? { type: "axElement", roleLabel } : undefined;
    }
    case "visual": {
      const prompt = asString(record.prompt);
      return prompt !== undefined ? { type: "visual", prompt } : undefined;
    }
    default:
      // Unrecognized expectation type: drop it, do not fail the step.
      return undefined;
  }
}

function decodeWatch(value: unknown): IrisStepWatch | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = asRecord(value);
  const rawExpectations = Array.isArray(record.expect) ? record.expect : [];
  const expect = rawExpectations
    .map((expectation) => decodeExpectation(expectation))
    .filter((expectation): expectation is IrisStepExpectation => expectation !== undefined);
  // Absent means not sensitive; anything that is not explicitly `false` leaves
  // capture off, the cautious reading of a malformed value (matches Swift).
  const sensitive = record.sensitive === undefined ? false : record.sensitive !== false;
  return { expect, sensitive, hints: asStringArray(record.hints) };
}

function decodePoint(value: unknown): IrisStepPointTarget | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = asRecord(value);
  const descriptor = asString(record.descriptor);
  if (descriptor === undefined) return undefined;
  const inApp = asString(record.inApp);
  const isWindow = typeof record.isWindow === "boolean" ? record.isWindow : undefined;
  return { descriptor, ...(inApp !== undefined ? { inApp } : {}), ...(isWindow !== undefined ? { isWindow } : {}) };
}

/// Decodes one step, or `undefined` when it has no usable `id` (a step with no
/// identity cannot be tracked, so it is dropped rather than carried as a blank).
function decodeStep(value: unknown): IrisGuideStep | undefined {
  const record = asRecord(value);
  const id = asString(record.id);
  if (id === undefined || id === "") return undefined;
  return {
    id,
    kind: decodeStepKind(record.kind),
    title: asStringOrEmpty(record.title),
    body: asStringOrEmpty(record.body),
    tool: decodeTool(record.tool),
    command: asString(record.command),
    href: asString(record.href),
    actionLabel: asString(record.actionLabel),
    verifierLabel: asString(record.verifierLabel),
    watch: decodeWatch(record.watch),
    point: decodePoint(record.point),
    workingDirectory: asString(record.workingDirectory),
  };
}

function decodeSteps(value: unknown): IrisGuideStep[] {
  return Array.isArray(value)
    ? value.map((step) => decodeStep(step)).filter((step): step is IrisGuideStep => step !== undefined)
    : [];
}

function decodeUnsupported(value: unknown): IrisUnsupportedPair | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = asRecord(value);
  const headline = asString(record.headline);
  const reason = asString(record.reason);
  if (headline === undefined || reason === undefined) return undefined;
  return { headline, reason, alternatives: asStringArray(record.alternatives) };
}

/// Decodes one branch, or `undefined` when its platform is neither `macos` nor
/// `windows` (a branch Iris cannot place is dropped, not carried).
function decodeBranch(value: unknown): IrisGuideBranch | undefined {
  const record = asRecord(value);
  const platform = record.platform;
  if (platform !== "macos" && platform !== "windows") return undefined;
  const target = record.target === "ios" || record.target === "android" ? record.target : undefined;
  const label = asString(record.label) ?? (platform === "windows" ? "Windows" : "macOS");
  return {
    platform,
    ...(target !== undefined ? { target } : {}),
    label,
    shell: decodeShell(record.shell),
    setupSteps: decodeSteps(record.setupSteps),
    steps: decodeSteps(record.steps),
    unsupported: decodeUnsupported(record.unsupported),
  };
}

function decodeStatus(value: unknown): IrisGuideStatus {
  return value === "pilot" || value === "approved" || value === "review" ? value : "review";
}

function decodeOutputType(value: unknown): IrisGuideOutputType {
  return value === "desktop_app" || value === "local_web" || value === "mobile_app" || value === "credential"
    ? value
    : "local_web";
}

/// Turns the parsed JSON body of the guides route into a strict `IrisGuide`,
/// applying the lenient rules above. TOTAL: it never throws — a wholly malformed
/// payload decodes to a guide with an empty branch list, which the resolver reads
/// as "no Windows steps" and answers with a built-in fallback.
export function decodeIrisGuide(value: unknown): IrisGuide {
  const record = asRecord(value);
  const rawBranches = Array.isArray(record.branches) ? record.branches : [];
  const branches = rawBranches
    .map((branch) => decodeBranch(branch))
    .filter((branch): branch is IrisGuideBranch => branch !== undefined);
  return {
    appSlug: asStringOrEmpty(record.appSlug),
    appName: asStringOrEmpty(record.appName),
    version: asFiniteNumber(record.version) ?? 0,
    status: decodeStatus(record.status),
    sourceOwner: asStringOrEmpty(record.sourceOwner),
    sourceRepo: asStringOrEmpty(record.sourceRepo),
    sourceCommit: asString(record.sourceCommit),
    outputType: decodeOutputType(record.outputType),
    estimatedMinutes: asFiniteNumber(record.estimatedMinutes),
    readmeSectionIds: asStringArray(record.readmeSectionIds),
    reviewNote: asString(record.reviewNote),
    branches,
  };
}

/// The branch identity used as the `branch` parameter of an `iris://` handoff and
/// for progress storage — `platform:target`, with a desktop/local branch reading
/// as `…:desktop`. Equivalent to `branchKey()` in `lib/iris-guides.ts` and
/// `IrisGuide.branchKey(for:)` in Swift.
export function branchKeyFor(branch: IrisGuideBranch): string {
  return `${branch.platform}:${branch.target ?? "desktop"}`;
}

/// The branch a `platform:target` key names, or `undefined` when the guide has no
/// such branch — what makes a stale link land somewhere real, not somewhere wrong.
export function branchMatchingKey(guide: IrisGuide, branchKey: string): IrisGuideBranch | undefined {
  return guide.branches.find((branch) => branchKeyFor(branch) === branchKey);
}
