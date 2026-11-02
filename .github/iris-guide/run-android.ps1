$jh = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
if ($jh) { $env:JAVA_HOME = $jh; $env:Path = $jh + '\bin;' + $env:Path }
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
$sdkDefault = $HOME + '\AppData\Local\Android\Sdk'
if (-not $sdk -and (Test-Path $sdkDefault)) { $sdk = $sdkDefault; $env:ANDROID_HOME = $sdk }
$adb = New-Object System.Diagnostics.ProcessStartInfo ($sdk + '\platform-tools\adb.exe'), 'start-server'
$adb.UseShellExecute = $true
$adb.WindowStyle = 'Hidden'
if ($sdk -and (Test-Path $adb.FileName)) { [System.Diagnostics.Process]::Start($adb).WaitForExit() }
$env:GRADLE_OPTS = '-Dorg.gradle.daemon=false'
npx.cmd expo run:android --variant release