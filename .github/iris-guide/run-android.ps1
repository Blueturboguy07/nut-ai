$jh = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
if ($jh) { $env:JAVA_HOME = $jh; $env:Path = $jh + '\bin;' + $env:Path }
$env:GRADLE_OPTS = '-Dorg.gradle.daemon=false'
${env:ORG_GRADLE_PROJECT_kotlin.compiler.execution.strategy} = 'in-process'
npx.cmd expo run:android --variant release