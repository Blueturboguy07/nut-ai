$jh = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
if ($jh) { $env:JAVA_HOME = $jh; $env:Path = $jh + '\bin;' + $env:Path }
npx.cmd expo run:android --variant release