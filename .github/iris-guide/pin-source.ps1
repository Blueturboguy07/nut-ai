$origin = git config --get remote.origin.url 2>$null
if ($origin) { $origin = $origin -replace '^git@github\.com:', 'https://github.com/' -replace '\.git$', '' }
if ($origin -ne "https://github.com/Blueturboguy07/nut-ai") {
  Write-Host "~/nut-ai already exists and is not a copy of this app's source. Move or rename that folder, then press Try again."
  exit 1
}
git cat-file -e 0000000000000000000000000000000000000000 2>$null
if ($LASTEXITCODE -ne 0) { git fetch --no-tags https://github.com/Blueturboguy07/nut-ai.git 0000000000000000000000000000000000000000 }
if ($LASTEXITCODE -ne 0) {
  Write-Host "Could not download the reviewed version. Check your internet connection, then press Try again."
  exit 1
}
$dirty = git status --porcelain 2>$null
if ($dirty) {
  git -c user.name=iris-guide -c user.email=iris-guide@localhost stash push --include-untracked -m "Saved by the install guide"
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Write-Host "Your changes in ~/nut-ai are saved with git stash. To see them: git stash list"
}
git checkout 0000000000000000000000000000000000000000