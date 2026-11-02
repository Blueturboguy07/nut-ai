# Lists the processes a Gradle build can leave running after the step that
# started it (they may hold the step's output pipe, which Iris for Windows
# waits on), then optionally stops them. Prints kinds and ids only, never
# command lines.
#   -Label        text for the heading
#   -FailOnDaemon exit 1 when a GradleDaemon or KotlinCompileDaemon is running
#   -Stop         then stop every java, aapt2 and adb process
param([string]$Label = '', [switch]$FailOnDaemon, [switch]$Stop)

function Get-BuildProcesses {
  $names = '^(java|aapt2|adb|node|cmake|ninja|clang|clang\+\+|hermesc)\.exe$'
  @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match $names } | ForEach-Object {
    $cmd = [string]$_.CommandLine
    $kind = $_.Name
    if ($cmd -match 'KotlinCompileDaemon') { $kind = 'KotlinCompileDaemon' }
    elseif ($cmd -match 'GradleDaemon') { $kind = 'GradleDaemon' }
    elseif ($cmd -match 'GradleWorkerMain') { $kind = 'GradleWorkerMain' }
    elseif ($cmd -match 'GradleWrapperMain|org\.gradle\.launcher\.GradleMain') { $kind = 'gradle-launcher' }
    [pscustomobject]@{ Id = $_.ProcessId; Parent = $_.ParentProcessId; Kind = $kind }
  })
}

$found = Get-BuildProcesses
Write-Output "--- build processes still running $Label`: $($found.Count)"
foreach ($p in $found) { Write-Output ("    {0,-20} id {1,7} parent {2,7}" -f $p.Kind, $p.Id, $p.Parent) }
$daemons = @($found | Where-Object { $_.Kind -in 'GradleDaemon', 'KotlinCompileDaemon' })

if ($Stop) {
  $adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
  if ($env:ANDROID_HOME -and (Test-Path $adb)) { & $adb kill-server 2>&1 | Out-Null }
  Get-Process java, aapt2, adb -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Write-Output "--- stopped; java/aapt2/adb left: $(@(Get-Process java, aapt2, adb -ErrorAction SilentlyContinue).Count)"
}
if ($FailOnDaemon -and $daemons.Count -gt 0) {
  Write-Output "--- $($daemons.Count) daemon(s) outlived the step: $(($daemons | ForEach-Object Kind) -join ', ')"
  exit 1
}
exit 0
