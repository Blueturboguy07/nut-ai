# Reads the JDK the guide's install-jdk saved in ~\.nut-ai-java-home, runs
# its java and prints the folder and the major version. Fails when nothing is
# saved, when the saved folder has no java.exe or no javac.exe (a Java
# runtime, JRE, is not a JDK: Gradle stops with "No Java compiler found"),
# when the path ends in a backslash (the build steps quote it in GRADLE_OPTS),
# when the major is outside the range the build is proven on (17 to 21), or
# when it is not -Expect.
param([int]$Expect = 0)

$file = Join-Path $HOME '.nut-ai-java-home'
if (-not (Test-Path $file)) { Write-Error 'install-jdk saved no JDK (no ~\.nut-ai-java-home)'; exit 1 }
$jdk = (Get-Content $file -TotalCount 1 -Encoding UTF8).Trim()
$java = Join-Path $jdk 'bin\java.exe'
if (-not (Test-Path -LiteralPath $java)) { Write-Error "the saved JDK has no java.exe: $jdk"; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $jdk 'bin\javac.exe'))) { Write-Error "the saved folder is a Java runtime, not a JDK (no javac.exe): $jdk"; exit 1 }
if ($jdk.EndsWith('\')) { Write-Error "the saved path ends in a backslash: $jdk"; exit 1 }
$version = & $java -version 2>&1 | Out-String
$match = [regex]::Match($version, 'version "(1\.)?(\d+)')
if (-not $match.Success) { Write-Error "no version from $java"; exit 1 }
$major = [int]$match.Groups[2].Value
$line = "install-jdk saved $jdk (Java $major, with javac.exe)"
Write-Output $line
$line >> $env:GITHUB_STEP_SUMMARY
if ($major -lt 17 -or $major -gt 21) { Write-Error "Java $major is outside 17 to 21"; exit 1 }
if ($Expect -and $major -ne $Expect) { Write-Error "expected Java $Expect"; exit 1 }
exit 0
