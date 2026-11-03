function Get-JavaMajor ($jdk) {
  if (-not $jdk -or -not (Test-Path -LiteralPath ($jdk + '\bin\java.exe')) -or -not (Test-Path -LiteralPath ($jdk + '\bin\javac.exe'))) { return 0 }
  $keep = $env:Path
  $env:Path = $jdk + '\bin;' + $env:Path
  $v = cmd /c "java -version 2>&1" | Out-String
  $env:Path = $keep
  if ($v -match 'version "1\.(\d+)') { return [int]$Matches[1] }
  if ($v -match 'version "(\d+)') { return [int]$Matches[1] }
  return 0
}
function Find-Jdk ($dirs, $low, $high) {
  foreach ($d in $dirs) { $m = Get-JavaMajor $d; if ($m -ge $low -and $m -le $high) { return $d.TrimEnd('\') } }
}
$roots = 'Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'Amazon Corretto', 'Android\Android Studio'
function Get-Jdks { $roots | ForEach-Object { Get-ChildItem (Join-Path $env:ProgramFiles $_) -Directory -ErrorAction SilentlyContinue } | ForEach-Object { $_.FullName } }
$homes = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User'), [Environment]::GetEnvironmentVariable('JAVA_HOME', 'Machine'), $env:JAVA_HOME
$jdk = Find-Jdk $homes 17 21
if (-not $jdk) { $jdk = Find-Jdk (Get-Jdks) 17 17 }
if (-not $jdk) { $jdk = Find-Jdk (Get-Jdks) 18 21 }
if (-not $jdk) {
  winget install --id EclipseAdoptium.Temurin.17.JDK -e --source winget --accept-source-agreements --accept-package-agreements
  $jdk = Find-Jdk (Get-Jdks) 17 17
}
if (-not $jdk) { Write-Output 'No JDK 17 is installed yet. Install the Temurin 17 JDK from adoptium.net, then run this step again.'; exit 1 }
Set-Content -Path ($HOME + '\.nut-ai-java-home') -Value $jdk -Encoding UTF8
$env:JAVA_HOME = $jdk
$env:Path = $jdk + '\bin;' + $env:Path
Write-Output ('The Android build uses the Java in ' + $jdk)
cmd /c "java -version 2>&1"