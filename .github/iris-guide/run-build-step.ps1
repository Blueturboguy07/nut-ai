# Runs one of the guide's Android build steps through run-like-iris.mjs the
# way a reader's PC runs it (no ANDROID_HOME or ANDROID_SDK_ROOT, so the
# prelude finds the SDK in the default folder; with -NoCi also no CI
# variable, so expo's eager JS export resets Metro's cache as it does on a
# PC), then reports the step:
#   - the exit code Iris would record, when the BUILD line came, when the
#     pipe closed ('close', where Iris ends the step);
#   - which ABIs the CMake tasks were for; how many native outputs ninja
#     really built in the step, for the libraries and for the app (new lines
#     in every .ninja_log: AGP runs its CMake tasks on every build and ninja
#     decides, so a CMake task header alone proves nothing); and how many
#     library Kotlin compiles RAN (a task header with no UP-TO-DATE /
#     NO-SOURCE / SKIPPED suffix). Together they show that a later step does
#     not redo an earlier one;
#   - whether a Gradle daemon outlived the step.
# Appends one JSON line to $RUNNER_TEMP/r5/results.jsonl and one row to the
# job summary. Exit code: the code Iris would record, or 1 when a Gradle
# daemon outlived the step.
param(
  [Parameter(Mandatory = $true)][string]$Step,
  [Parameter(Mandatory = $true)][string]$Run,
  [Parameter(Mandatory = $true)][string]$CommandFile,
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [int]$Deadline = 900,
  [int]$Linger = 300,
  [switch]$NoCi
)

$dir = Join-Path $env:RUNNER_TEMP 'r5'
New-Item -ItemType Directory -Force $dir | Out-Null

# Lines in the .ninja_log files under the libraries' and the app's .cxx
# folders: ninja appends one line per output it builds.
function Get-NinjaLines([string]$Which) {
  $ws = $env:GITHUB_WORKSPACE
  $roots = if ($Which -eq 'app') {
    @(Join-Path $ws 'apps\mobile\android\app\.cxx')
  } else {
    @(Get-ChildItem (Join-Path $ws 'node_modules') -Directory -Force -ErrorAction SilentlyContinue |
        ForEach-Object { if ($_.Name.StartsWith('@')) { Get-ChildItem $_.FullName -Directory -Force } else { $_ } } |
        ForEach-Object { Join-Path $_.FullName 'android\.cxx' })
  }
  $count = 0
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($log in @(Get-ChildItem $root -Recurse -Force -Filter '.ninja_log' -ErrorAction SilentlyContinue)) {
      $count += @(Get-Content $log.FullName | Where-Object { $_ -and -not $_.StartsWith('#') }).Count
    }
  }
  $count
}
$ninjaLibBefore = Get-NinjaLines 'libraries'
$ninjaAppBefore = Get-NinjaLines 'app'
$log = Join-Path $dir "$Step-$Run.log"
$sdkForCi = $env:ANDROID_HOME
$ciForCi = $env:CI
Remove-Item Env:ANDROID_HOME, Env:ANDROID_SDK_ROOT -ErrorAction SilentlyContinue
if ($NoCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue }
node (Join-Path $PSScriptRoot 'run-like-iris.mjs') $CommandFile $WorkDir $log $Deadline $Linger
$env:ANDROID_HOME = $sdkForCi
$env:CI = $ciForCi

$ninjaLib = (Get-NinjaLines 'libraries') - $ninjaLibBefore
$ninjaApp = (Get-NinjaLines 'app') - $ninjaAppBefore

& (Join-Path $PSScriptRoot 'build-processes.ps1') -Label "after $Step ($Run)" -FailOnDaemon
$daemonLeft = $LASTEXITCODE -ne 0

$t = Get-Content "$log.timing.json" | ConvertFrom-Json
$text = @(Get-Content $log)
$said = ($text | Select-String -Pattern 'BUILD (SUCCESSFUL|FAILED) in' | Select-Object -Last 1).Line
$eager = $text | Select-String -Pattern "eager JS export ended at ([\d.]+) s" | Select-Object -First 1
$eagerAt = if ($eager) { [double]$eager.Matches[0].Groups[1].Value } else { $null }
$ran = @($text | Where-Object { $_ -match '^> Task :\S+$' } | ForEach-Object { $_.Substring(7) } | Sort-Object -Unique)
$abis = @($text | Select-String -Pattern 'buildCMake\w+\[([\w-]+)\]' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
$libKotlinRan = @($ran | Where-Object { $_ -match ':compileReleaseKotlin$' -and $_ -notmatch '^:app:' }).Count
$downloads = @($text | Where-Object { $_ -match 'Downloading https://services\.gradle\.org|Installing NDK|Installing CMake' }).Count

$row = [ordered]@{
  step = $Step; run = $Run; deadline = $Deadline; recorded = [int]$t.recorded; kind = $t.kind
  closeAt = [double]$t.endedAt; exitedAt = $t.exitedAt; buildLineAt = $t.buildLineAt; eagerAt = $eagerAt
  said = $said; tasksRan = $ran.Count; ninjaLib = $ninjaLib; ninjaApp = $ninjaApp; libKotlinRan = $libKotlinRan
  abis = ($abis -join ','); downloads = $downloads; daemonLeft = $daemonLeft
}
($row | ConvertTo-Json -Compress) | Add-Content (Join-Path $dir 'results.jsonl')
$eagerText = if ($null -ne $eagerAt) { "; eager JS export ended at $eagerAt s" } else { '' }
"| $Step | $Run | $Deadline | $($t.recorded) | $($t.buildLineAt) | $($t.endedAt) | $said$eagerText; tasks run $($ran.Count), ninja built $ninjaLib (libraries) + $ninjaApp (app), library Kotlin run $libKotlinRan, ABIs [$($abis -join ' ')] |" >> $env:GITHUB_STEP_SUMMARY
Write-Output "--- $Step ($Run): Iris $($t.recorded), powershell.exe exited at $($t.exitedAt) s, 'close' at $($t.endedAt) s; $said"
Write-Output "--- tasks run: $($ran.Count); ninja built: $ninjaLib (libraries) + $ninjaApp (app); library Kotlin run: $libKotlinRan; ABIs: $($abis -join ' ')$eagerText"
if ($daemonLeft) { Write-Output '--- a Gradle daemon outlived the step'; exit 1 }
exit ([int]$t.recorded)
