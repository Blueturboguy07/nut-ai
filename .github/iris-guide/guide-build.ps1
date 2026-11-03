# Runs the guide's seven Android build steps once, in the guide's order,
# through run-build-step.ps1 (run-like-iris.mjs, the copy of Iris for
# Windows' step runner), in $env:NUT_AI\apps\mobile. The steps are the
# verbatim guide copies beside this file; run-android's last line is
# replaced by expo-build-no-phone.mjs (CI has no phone), as in the
# run-android-split-steps job. It stops at the first step Iris would not
# record as exit 0, then checks every step:
#   - Iris exit 0 and Gradle's BUILD SUCCESSFUL;
#   - the pipe closed within -Limit seconds (Iris's own limit is 900 s).
# Used by the reader-java and returning-reader jobs. Exit 1 on any failure.
param(
  [Parameter(Mandatory = $true)][string]$Run,
  [int]$Limit = 900
)

$guide = $PSScriptRoot
$dir = Join-Path $env:RUNNER_TEMP 'r5'
New-Item -ItemType Directory -Force $dir | Out-Null
$app = Join-Path $env:NUT_AI 'apps\mobile'
$android = Join-Path $app 'android'

# The seven steps share one prelude (the publik guide builds them from one
# list); run-android in CI keeps it and swaps only the expo line.
$steps = 'prepare-gradle', 'build-native-1', 'build-native-2', 'build-native-app', 'build-libraries', 'prepare-app', 'run-android'
$lines = @((Get-Content (Join-Path $guide 'run-android.ps1') -Raw) -split '\r?\n' | Where-Object { $_ -ne '' })
if ($lines[-1] -ne 'npx.cmd expo run:android --variant release --no-bundler') { Write-Error 'run-android.ps1 no longer ends with the expo line'; exit 1 }
$prelude = @($lines[0..($lines.Count - 2)]) -join "`n"
$standIn = 'node "' + (Join-Path $guide 'expo-build-no-phone.mjs') + '"'
$noPhone = Join-Path $dir 'run-android-no-phone.ps1'
Set-Content $noPhone ($prelude + "`n" + $standIn)

$fail = @()
foreach ($id in $steps) {
  $file = if ($id -eq 'run-android') { $noPhone } else { Join-Path $guide "$id.ps1" }
  $work = if ($id -eq 'run-android') { $app } else { $android }
  $extra = if ($id -eq 'run-android') { @{ NoCi = $true } } else { @{} }
  & (Join-Path $guide 'run-build-step.ps1') -Step $id -Run $Run -CommandFile $file -WorkDir $work -Deadline 1800 @extra
  $r = Get-Content (Join-Path $dir 'results.jsonl') | ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object { $_.step -eq $id -and $_.run -eq $Run } | Select-Object -Last 1
  if (-not $r) { $fail += "$id ($Run) did not run"; break }
  if ($r.recorded -ne 0) { $fail += "${id} ($Run): Iris would record $($r.recorded)" }
  if ($r.said -notmatch 'BUILD SUCCESSFUL') { $fail += "${id} ($Run): no BUILD SUCCESSFUL ($($r.said))" }
  if ([double]$r.closeAt -gt $Limit) { $fail += "${id} ($Run): 'close' at $($r.closeAt) s, over $Limit s" }
  if ($r.recorded -ne 0) { break }
}
& (Join-Path $guide 'build-processes.ps1') -Label "after the $Run build" -Stop
if ($fail.Count -gt 0) { $fail | ForEach-Object { Write-Output "FAIL: $_" }; Write-Error "$($fail.Count) check(s) failed"; exit 1 }
Write-Output "all seven build steps ($Run): Iris exit 0, BUILD SUCCESSFUL, each closed within $Limit s"
exit 0
