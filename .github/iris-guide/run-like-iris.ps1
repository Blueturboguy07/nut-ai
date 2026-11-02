# Runs one publik guide command the way Iris for Windows runs it, so CI sees
# what a reader's PC sees. Mirrors iris-windows/src/main/powershell-session.ts
# (wrapCommandScript + parseRun):
#   - a fresh powershell.exe (Windows PowerShell 5.1) per command, so nothing
#     but the folder carries over from the step before;
#   - PATH rebuilt from the registry (Machine + User) before the command; every
#     other variable, JAVA_HOME included, is what the parent process had;
#   - the command in its own `& { }` block, the exit code read back from a
#     marker line, and a missing marker counted as exit 1.
#
# install-jdk.ps1 and run-android.ps1 beside this file are VERBATIM copies of
# the Windows commands in publik lib/guides/nut-ai.ts (guide v16). Do not edit
# them here; copy them again from the guide.
param(
  [Parameter(Mandatory = $true)] [string] $Command,
  [Parameter(Mandatory = $true)] [string] $WorkingDirectory,
  [string] $LogFile
)

$script = @(
  '$ProgressPreference = ''SilentlyContinue'''
  '$env:Path = [System.Environment]::GetEnvironmentVariable(''Path'',''Machine'') + '';'' + [System.Environment]::GetEnvironmentVariable(''Path'',''User'')'
  'Set-Location -LiteralPath ''' + $WorkingDirectory.Replace("'", "''") + ''''
  '$global:LASTEXITCODE = 0'
  '& { ' + $Command + ' }'
  '$__code = if ($LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif (-not $?) { 1 } else { 0 }'
  'Write-Output "__IRIS_CWD__:$($ExecutionContext.SessionState.Path.CurrentLocation.Path)"'
  'Write-Output "__IRIS_CODE__:$__code"'
  ''
) -join "`n"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'powershell.exe'
$psi.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $encoded
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($psi)
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$process.WaitForExit()
$stdout = $stdoutTask.Result
$stderr = $stderrTask.Result

$code = $null
$visible = foreach ($line in ($stdout -split "`r?`n")) {
  if ($line.StartsWith('__IRIS_CODE__:')) { $code = [int]$line.Substring('__IRIS_CODE__:'.Length).Trim() }
  elseif ($line.StartsWith('__IRIS_CWD__:')) { }
  else { $line }
}
if ($null -eq $code) { $code = 1 }
$output = (($visible -join "`n") + "`n" + $stderr).Trim()
if ($LogFile) { Set-Content -Path $LogFile -Value $output -Encoding utf8 }
Write-Output $output
Write-Output "--- Iris would record exit code $code (powershell.exe exited $($process.ExitCode))"
exit $code
