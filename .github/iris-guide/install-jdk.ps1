$jh = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
if ($jh) { $env:JAVA_HOME = $jh }
if ($env:JAVA_HOME) { $env:Path = $env:JAVA_HOME + '\bin;' + $env:Path }
function Get-JavaMajor {
  if ($env:JAVA_HOME -and -not (Test-Path ($env:JAVA_HOME + '\bin\java.exe'))) { return 0 }
  $v = cmd /c "java -version 2>&1" | Out-String
  if ($v -match 'version "1\.(\d+)') { return [int]$Matches[1] }
  if ($v -match 'version "(\d+)') { return [int]$Matches[1] }
  return 0
}
if ((Get-JavaMajor) -lt 17) {
  $root = Join-Path $env:ProgramFiles 'Eclipse Adoptium'
  $jdk = Get-ChildItem $root -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if (-not $jdk) {
    winget install --id EclipseAdoptium.Temurin.17.JDK -e --source winget --accept-source-agreements --accept-package-agreements
    $jdk = Get-ChildItem $root -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -Last 1
  }
  if ($jdk) {
    $env:JAVA_HOME = $jdk.FullName
    $env:Path = $jdk.FullName + '\bin;' + $env:Path
    [Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk.FullName, 'User')
  }
}
java -version
if ((Get-JavaMajor) -lt 17) { throw 'Java 17 or newer is still missing. Install Temurin 17 from adoptium.net, then run this step again.' }