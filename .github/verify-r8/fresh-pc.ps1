# Blind verify r6: make this runner a fresh reader PC (copied from the r5 job, run 41560847103).
# Removes every Java from PATH and the registry, every ANDROID_*/JAVA_HOME* variable, installs a fresh
# SDK at %LOCALAPPDATA%\Android\Sdk (platform-tools, android-36, build-tools 36.0.0, licenses), and
# writes the environment a GUI app started from Explorer gets (registry Machine + User + per-session).
# Optional: $env:NEWJAVA = a JDK folder to leave as the user's JAVA_HOME (registry User), like a reader
# who has a newer JDK set.
$ErrorActionPreference = 'Continue'
node --version
$nodeDir = Split-Path (Get-Command node).Source
npm install -g tsx@4.19.2 --no-audit --no-fund 2>&1 | Select-Object -Last 2
$tsxCli = Join-Path (npm root -g) 'tsx\dist\cli.mjs'
if (-not (Test-Path $tsxCli)) { Write-Error "no tsx cli at $tsxCli"; exit 1 }
$javaForSdkmanager = $env:JAVA_HOME_17_X64
$runnerSdk = $env:ANDROID_HOME
$isJava = '(?i)\\java|jdk|jre|javapath|adoptium|zulu|corretto'
foreach ($scope in 'Machine', 'User') {
  $entries = @(([Environment]::GetEnvironmentVariable('Path', $scope)) -split ';' | Where-Object { $_ })
  $removed = @($entries | Where-Object { $_ -match $isJava })
  $kept = @($entries | Where-Object { $_ -notmatch $isJava })
  if ($scope -eq 'Machine') { $kept = @($nodeDir) + $kept }
  Write-Output "$scope Path: removed $($removed.Count) Java entries"
  [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), $scope)
}
foreach ($scope in 'Machine', 'User') {
  $vars = [Environment]::GetEnvironmentVariables($scope)
  foreach ($k in @($vars.Keys)) {
    if ($k -match '^(ANDROID_|JAVA_HOME)') { [Environment]::SetEnvironmentVariable($k, $null, $scope); Write-Output "removed $scope $k" }
  }
}
if ($env:PRE_JDK25) {
  # A reader who installed Temurin 25 (current LTS) with its installer and set JAVA_HOME to it.
  winget install --id EclipseAdoptium.Temurin.25.JDK -e --source winget --accept-source-agreements --accept-package-agreements 2>&1 | Select-Object -Last 3
  $j25 = Get-ChildItem (Join-Path $env:ProgramFiles 'Eclipse Adoptium') -Directory -Filter 'jdk-25*' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($j25) { $env:NEWJAVA = $j25.FullName } else { Write-Output "winget gave no jdk-25 folder; using setup-java's $env:NEWJAVA" }
  $mp = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  if ($mp -notmatch [regex]::Escape($env:NEWJAVA)) { [Environment]::SetEnvironmentVariable('Path', ($env:NEWJAVA + '\bin;' + $mp), 'Machine') }
  if ($env:GRADLE_PROPS_JDK25) {
    $gp = Join-Path $HOME '.gradle'
    New-Item -ItemType Directory -Force $gp | Out-Null
    Set-Content -Path (Join-Path $gp 'gradle.properties') -Value ('org.gradle.java.home=' + ($env:NEWJAVA -replace '\\', '/')) -Encoding ASCII
    Write-Output ('~/.gradle/gradle.properties: ' + (Get-Content (Join-Path $gp 'gradle.properties')))
  }
}
if ($env:PRE_JRE17) {
  # A reader who installed the Temurin 17 JRE (runtime only, no javac) with its installer.
  winget install --id EclipseAdoptium.Temurin.17.JRE -e --source winget --accept-source-agreements --accept-package-agreements 2>&1 | Select-Object -Last 3
  $jre = Get-ChildItem (Join-Path $env:ProgramFiles 'Eclipse Adoptium') -Directory -Filter 'jre-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $jre) { Write-Output 'no JRE 17 folder after winget'; exit 1 }
  Write-Output "JRE install made: $($jre.FullName); javac: $(Test-Path (Join-Path $jre.FullName 'bin\javac.exe'))"
  if ($env:JRE_AS_JAVAHOME) { $env:NEWJAVA = $jre.FullName + '\' }
}
if ($env:JDK17_TRAILING) { $env:NEWJAVA = $env:JAVA_HOME_17_X64.TrimEnd('\') + '\' }
if ($env:PROPS_JAVA) {
  $gp = Join-Path $HOME '.gradle'
  New-Item -ItemType Directory -Force $gp | Out-Null
  Set-Content -Path (Join-Path $gp 'gradle.properties') -Value ('org.gradle.java.home=' + ($env:PROPS_JAVA -replace '\\', '/')) -Encoding ASCII
  Write-Output ('~/.gradle/gradle.properties: ' + (Get-Content (Join-Path $gp 'gradle.properties')))
}
# Blind verify r8: every Gradle build (the guide's gradlew and the one expo starts) logs the JVM it runs in.
$initDir = Join-Path $HOME '.gradle\init.d'
New-Item -ItemType Directory -Force $initDir | Out-Null
Set-Content -Path (Join-Path $initDir 'blind-jvm.gradle') -Encoding ASCII -Value @'
def line = "java.version=${System.getProperty('java.version')} java.home=${System.getProperty('java.home')} tasks=${gradle.startParameter.taskNames}"
new File(System.getProperty('user.home'), 'blind-jvm.log') << (line + "\n")
println "BLIND-JVM " + line
'@
if ($env:NEWJAVA) {
  [Environment]::SetEnvironmentVariable('JAVA_HOME', $env:NEWJAVA, 'User')
  Write-Output "reader's own JAVA_HOME (User): [$env:NEWJAVA]"
  & (Join-Path $env:NEWJAVA 'bin\java.exe') -version 2>&1 | Select-Object -First 1
}
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
New-Item -ItemType Directory -Force $sdk | Out-Null
$sm = Join-Path $runnerSdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$env:JAVA_HOME = $javaForSdkmanager
$yes = @('y') * 20 -join "`n"
$yes | & $sm "--sdk_root=$sdk" --licenses 2>&1 | Select-Object -Last 2
& $sm "--sdk_root=$sdk" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 2>&1 | Select-Object -Last 3
Get-ChildItem $sdk | ForEach-Object { "fresh SDK has: $($_.Name)" }
Get-ChildItem (Join-Path $env:ProgramFiles 'Eclipse Adoptium') -ErrorAction SilentlyContinue | ForEach-Object { "already under Program Files: $($_.FullName)" }
$e = @{}
foreach ($scope in 'Machine', 'User') {
  $vars = [Environment]::GetEnvironmentVariables($scope)
  foreach ($k in $vars.Keys) { $e[$k] = [Environment]::ExpandEnvironmentVariables([string]$vars[$k]) }
}
$e['Path'] = [Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'))
foreach ($k in 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'SystemRoot', 'windir', 'SystemDrive', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'ALLUSERSPROFILE', 'PUBLIC', 'ComSpec', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'NUMBER_OF_PROCESSORS', 'OS') {
  $v = [Environment]::GetEnvironmentVariable($k, 'Process'); if ($v) { $e[$k] = $v }
}
foreach ($k in @($e.Keys)) { if ($k -match '^(ANDROID_|JAVA_HOME|CI$|GITHUB_|RUNNER_|ACTIONS_)') { $e.Remove($k) } }
if ($env:NEWJAVA) { $e['JAVA_HOME'] = $env:NEWJAVA }
$e['PSModulePath'] = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
$dir = Join-Path $env:RUNNER_TEMP 'blind'
New-Item -ItemType Directory -Force $dir | Out-Null
($e | ConvertTo-Json -Depth 2) | Set-Content -Encoding utf8 (Join-Path $dir 'env.json')
Write-Output "registry environment for the driver: $($e.Count) variables: $((@($e.Keys) | Sort-Object) -join ', ')"
"TSX_CLI=$tsxCli" >> $env:GITHUB_ENV
"C: free: $([math]::Round((Get-PSDrive C).Free / 1GB, 1)) GB; USERPROFILE $env:USERPROFILE" | Write-Output
exit 0
