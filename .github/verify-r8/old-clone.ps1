# Blind verify r7: a returning reader's ~/nut-ai as an older guide left it, then (variant) a dirty tree or a local branch.
# Variants: built  = detached at 71ee482, v15-era npm packages, expo prebuild, AND a Gradle release build (stale build/.cxx dirs)
#           dirty  = detached at 71ee482, packages + prebuild, a changed tracked file and a new untracked file
#           branch = on a local branch 'my-tweaks' with one local commit on top of 71ee482, packages + prebuild
param([string]$variant)
$ErrorActionPreference = 'Continue'
$old = '71ee482dae4a2c7f592103eb977248bc70ba4923'
$pin = '3dff45971c6a52410bd7b2ba40a38e331bd04938'
$nut = Join-Path $HOME 'nut-ai'
git clone --quiet --single-branch --branch main https://github.com/Blueturboguy07/nut-ai.git $nut
Set-Location $nut
git checkout --quiet $old
git cat-file -e $pin 2>$null
if ($LASTEXITCODE -eq 0) { Write-Output "the old clone already has $pin"; exit 1 }
npm install --no-audit --no-fund 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) {
  Write-Output 'v15-era npm install failed (node-gyp, as on PCs without Visual Studio); keeping its packages without scripts'
  npm install --no-audit --no-fund --ignore-scripts 2>&1 | Select-Object -Last 3
  if ($LASTEXITCODE -ne 0) { exit 1 }
}
Set-Location (Join-Path $nut 'apps\mobile')
npx expo prebuild --platform android 2>&1 | Select-Object -Last 3
if (-not (Test-Path android\gradlew.bat)) { Write-Output 'no android\gradlew.bat'; exit 1 }
if ($variant -eq 'built') {
  $env:JAVA_HOME = $env:JAVA_HOME_17_X64
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  $env:GRADLE_OPTS = '-Dorg.gradle.daemon=false'
  Set-Location android
  $t = Get-Date
  .\gradlew.bat app:assembleRelease -PreactNativeArchitectures=arm64-v8a 2>&1 | Select-Object -Last 4
  Write-Output ("old-pin Gradle release build: exit $LASTEXITCODE after " + [math]::Round(((Get-Date) - $t).TotalSeconds) + ' s')
  Get-ChildItem app\build\outputs\apk\release -Filter *.apk -ErrorAction SilentlyContinue | ForEach-Object { "old APK: $($_.Name) $([math]::Round($_.Length / 1MB, 1)) MB" }
  Remove-Item Env:JAVA_HOME, Env:ANDROID_HOME, Env:GRADLE_OPTS
}
Set-Location $nut
if ($variant -eq 'dirty') {
  Add-Content README.md "`nmy notes"
  Set-Content my-notes.txt 'mine'
}
if ($variant -eq 'branch') {
  git switch --quiet -c my-tweaks
  Add-Content README.md "`nmy tweak"
  git -c user.name=reader -c user.email=reader@localhost commit --quiet -m 'my tweak' -- README.md
  (git rev-parse HEAD) | Set-Content (Join-Path $env:RUNNER_TEMP 'my-tweaks.sha')
}
"old clone ($variant): HEAD $(git rev-parse --short HEAD) on '$(git branch --show-current)'; status: $(@(git status --porcelain).Count) entries; stash: $(@(git stash list).Count)" | Tee-Object -Append -FilePath $env:GITHUB_STEP_SUMMARY
@(git status --porcelain).Count | Set-Content (Join-Path $env:RUNNER_TEMP 'pre-status.txt')
git status --porcelain | ForEach-Object { "status before the guide: $_" }
Get-ChildItem (Join-Path $nut 'apps\mobile\android') -Directory -ErrorAction SilentlyContinue | ForEach-Object { "android/ has: $($_.Name)" }
exit 0
