# bugfix-lab oracle recipe (Windows) — nut-ai-databuild-fdc-foodcsv-missing
#
# Runs the exact command the guide's step 9 ("Build the nutrition database")
# tells a Windows reader to run, on a machine that has not pre-fetched the
# USDA CSVs (FDC_DIR points at a fresh, empty directory) — the same
# precondition every reporter's own terminal transcript shows (checkout ->
# npm install -> npm run data:build, no download step run in between).
#
# Prints BUGFIX_LAB_PRESENT and exits 1 if the build fails with the reported
# "missing food.csv" line; BUGFIX_LAB_ABSENT and exits 0 if it builds clean.

$ErrorActionPreference = "Continue"

$fdcDir = Join-Path $env:RUNNER_TEMP "fdc-scratch"
New-Item -ItemType Directory -Force -Path $fdcDir | Out-Null
$env:FDC_DIR = $fdcDir

Write-Host "FDC_DIR=$fdcDir (fresh, empty)"
Write-Host "running: npm.cmd run data:build"

npm.cmd run data:build 2>&1 | Tee-Object -Variable buildOutput | Write-Host
$buildExit = $LASTEXITCODE

Write-Host "npm.cmd run data:build exit code: $buildExit"

$buildText = $buildOutput -join "`n"
$matched = $buildText -match 'missing food\.csv at .*FoodData_Central_foundation_food_csv_[0-9-]+[/\\]food\.csv'

if ($buildExit -ne 0 -and $matched) {
  Write-Host "BUGFIX_LAB_PRESENT"
  exit 1
} elseif ($buildExit -eq 0) {
  Write-Host "BUGFIX_LAB_ABSENT"
  exit 0
} else {
  Write-Host "BUGFIX_LAB_UNKNOWN — non-zero exit ($buildExit) without the reported line"
  exit 1
}
