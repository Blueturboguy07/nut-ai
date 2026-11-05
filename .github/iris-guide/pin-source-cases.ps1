# The guide's pin-source step (pin-source.ps1, the verbatim Windows command
# with its pin replaced by 40 zeros) on old clones of this repository, run
# the way Iris for Windows runs it (run-like-iris.mjs: Windows PowerShell
# 5.1, the command in `& { }`, the exit marker). Every clone starts as guide
# v15 left it: a clone of main only, at 71ee482, so it has no copy of the
# commit under test (round 6 blind verify: `git checkout <sha>` there ended
# with "fatal: unable to read tree", exit 128). The pin is this commit
# ($env:GITHUB_SHA), fetched from GitHub by its sha. Cases:
#   clean      the old clone as it is
#   changed    a tracked edit and a new file (saved with git stash)
#   diverged   on main with a local commit (main keeps it)
#   ssh        origin is git@github.com:... (counts as this repository)
#   other      origin is another repository (stops, changes nothing)
#   offline    no network (stops before it changes anything)
# then `clean` again (nothing to fetch or save). Exit 1 on any failure.
param([string]$OldPin = '71ee482dae4a2c7f592103eb977248bc70ba4923')

$guide = $PSScriptRoot
$dir = Join-Path $env:RUNNER_TEMP 'pin'
New-Item -ItemType Directory -Force $dir | Out-Null
$zeros = '0' * 40
$template = Get-Content (Join-Path $guide 'pin-source.ps1') -Raw
if (-not $template.Contains("git checkout $zeros")) { Write-Error 'pin-source.ps1 has no git checkout of the zero pin'; exit 1 }
$command = Join-Path $dir 'pin-source.ps1'
Set-Content $command $template.Replace($zeros, $env:GITHUB_SHA) -NoNewline
$who = @('-c', 'user.name=ci', '-c', 'user.email=ci@localhost')

# A fresh old clone per case, as guide v15 made it.
function New-Clone([string]$Name) {
  $path = Join-Path $dir $Name
  git clone --quiet --no-tags --single-branch --branch main https://github.com/Blueturboguy07/nut-ai.git $path
  # Rewind to guide v15's clone: main and origin/main at the old pin and no
  # copy of anything newer. Once the commit under test is on main, a fresh
  # clone of main has it, so drop it here or the test proves nothing.
  git -C $path reset --quiet --hard $OldPin
  git -C $path update-ref refs/remotes/origin/main $OldPin
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $path '.git\ORIG_HEAD')
  git -C $path reflog expire --expire=now --all
  git -C $path gc --quiet --prune=now
  git -C $path checkout --quiet $OldPin
  git -C $path cat-file -e $env:GITHUB_SHA 2>$null
  if ($LASTEXITCODE -eq 0) { throw "the old clone already has $env:GITHUB_SHA" }
  $path
}
function Invoke-Pin([string]$Name, [string]$Clone) {
  $log = Join-Path $dir "$Name.log"
  node (Join-Path $guide 'run-like-iris.mjs') $command $Clone $log 300 | Out-Null
  $code = $LASTEXITCODE
  [pscustomobject]@{
    code = $code
    head = (git -C $Clone rev-parse HEAD)
    stashes = @(git -C $Clone stash list).Count
    status = (@(git -C $Clone status --porcelain | ForEach-Object { $_.Trim() }) -join ' | ')
    log = (Get-Content $log -Raw)
  }
}

$fail = @()
function Check([string]$Case, [bool]$Ok, [string]$What) {
  $mark = if ($Ok) { 'ok' } else { 'FAIL' }
  Write-Output "$Case - ${What}: $mark"
  "| $Case | $What | $mark |" >> $env:GITHUB_STEP_SUMMARY
  if (-not $Ok) { $script:fail += "${Case}: $What" }
}
"| case | check | result |" >> $env:GITHUB_STEP_SUMMARY
"|---|---|---|" >> $env:GITHUB_STEP_SUMMARY

$clean = New-Clone 'clean'
$r = Invoke-Pin 'clean' $clean
Check 'clean' ($r.code -eq 0) "Iris exit 0 (got $($r.code))"
Check 'clean' ($r.head -eq $env:GITHUB_SHA) 'HEAD is the pin'
Check 'clean' ($r.stashes -eq 0) 'nothing stashed'
Check 'clean' ($r.log -match 'HEAD is now at') "git says 'HEAD is now at'"

$changed = New-Clone 'changed'
Add-Content (Join-Path $changed 'README.md') "`nmy notes"
Set-Content (Join-Path $changed 'my-notes.txt') 'mine'
New-Item -ItemType Directory -Force (Join-Path $changed 'node_modules\x') | Out-Null
Set-Content (Join-Path $changed 'node_modules\x\index.js') '1'
$r = Invoke-Pin 'changed' $changed
Check 'changed' ($r.code -eq 0) "Iris exit 0 (got $($r.code))"
Check 'changed' ($r.head -eq $env:GITHUB_SHA) 'HEAD is the pin'
Check 'changed' ($r.stashes -eq 1) "one stash (got $($r.stashes))"
Check 'changed' ($r.status -eq '') "clean tree after (got '$($r.status)')"
Check 'changed' ($r.log -match 'Your changes in ~/nut-ai are saved with git stash') 'says the changes are saved'
$stashed = @(git -C $changed stash show --include-untracked --name-only 'stash@{0}')
Check 'changed' (($stashed.Count -eq 2) -and ($stashed -contains 'README.md') -and ($stashed -contains 'my-notes.txt')) "the stash holds README.md and my-notes.txt (got $($stashed -join ','))"
Check 'changed' (Test-Path (Join-Path $changed 'node_modules\x\index.js')) 'ignored files stay'

$diverged = New-Clone 'diverged'
git -C $diverged checkout --quiet main
Set-Content (Join-Path $diverged 'mine.txt') 'local work'
git -C $diverged add -A
git -C $diverged @who commit --quiet -m 'local work'
$local = git -C $diverged rev-parse main
$r = Invoke-Pin 'diverged' $diverged
Check 'diverged' ($r.code -eq 0) "Iris exit 0 (got $($r.code))"
Check 'diverged' ($r.head -eq $env:GITHUB_SHA) 'HEAD is the pin'
Check 'diverged' ((git -C $diverged rev-parse main) -eq $local) 'main keeps the local commit'

$ssh = New-Clone 'ssh'
git -C $ssh remote set-url origin git@github.com:Blueturboguy07/nut-ai.git
$r = Invoke-Pin 'ssh' $ssh
Check 'ssh' ($r.code -eq 0) "Iris exit 0 (got $($r.code))"
Check 'ssh' ($r.head -eq $env:GITHUB_SHA) 'HEAD is the pin'

$other = New-Clone 'other'
git -C $other remote set-url origin https://github.com/someone-else/nut-ai.git
Add-Content (Join-Path $other 'README.md') "`nmine"
$r = Invoke-Pin 'other' $other
Check 'other' ($r.code -ne 0) "Iris exit not 0 (got $($r.code))"
Check 'other' ($r.head -eq $OldPin) 'HEAD unchanged'
Check 'other' ($r.stashes -eq 0) 'nothing stashed'
Check 'other' ($r.log -match 'is not a copy of this app') 'says the folder is not this app'

$offline = New-Clone 'offline'
Add-Content (Join-Path $offline 'README.md') "`nmine"
$env:HTTPS_PROXY = 'http://127.0.0.1:9'
$r = Invoke-Pin 'offline' $offline
Remove-Item Env:HTTPS_PROXY
Check 'offline' ($r.code -ne 0) "Iris exit not 0 (got $($r.code))"
Check 'offline' ($r.head -eq $OldPin) 'HEAD unchanged'
Check 'offline' ($r.stashes -eq 0) 'nothing stashed'
Check 'offline' ($r.status -eq 'M README.md') "the edit is still in the tree (got '$($r.status)')"
Check 'offline' ($r.log -match 'Could not download the reviewed version') 'says the download failed'

$r = Invoke-Pin 'clean-again' $clean
Check 'clean again' ($r.code -eq 0) "Iris exit 0 (got $($r.code))"
Check 'clean again' ($r.head -eq $env:GITHUB_SHA) 'HEAD is the pin'
Check 'clean again' ($r.stashes -eq 0) 'nothing stashed'

if ($fail.Count -gt 0) { Write-Error "$($fail.Count) check(s) failed"; exit 1 }
Write-Output 'pin-source: every old-clone case passed'
exit 0
