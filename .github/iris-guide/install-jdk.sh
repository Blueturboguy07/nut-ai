rm -f ~/.nut-ai-java-home
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/javac" ] && "$JAVA_HOME/bin/java" -version 2>&1 </dev/null | grep -Eq 'version "(1[7-9]|2[01])[."]'; then echo "$JAVA_HOME" > ~/.nut-ai-java-home; fi
[ -s ~/.nut-ai-java-home ] || find -L /Library/Java/JavaVirtualMachines ~/Library/Java/JavaVirtualMachines ~/.nut-ai-jdk -maxdepth 5 -path '*/Contents/Home/bin/java' 2>/dev/null | while IFS= read -r j; do [ -x "${j%/java}/javac" ] && "$j" -version 2>&1 </dev/null | grep -Eq 'version "17[."]' && echo "${j%/bin/java}" > ~/.nut-ai-java-home && break; done
[ -s ~/.nut-ai-java-home ] || find -L /Library/Java/JavaVirtualMachines ~/Library/Java/JavaVirtualMachines ~/.nut-ai-jdk -maxdepth 5 -path '*/Contents/Home/bin/java' 2>/dev/null | while IFS= read -r j; do [ -x "${j%/java}/javac" ] && "$j" -version 2>&1 </dev/null | grep -Eq 'version "(1[89]|2[01])[."]' && echo "${j%/bin/java}" > ~/.nut-ai-java-home && break; done
if [ ! -s ~/.nut-ai-java-home ]; then
  uname -m | grep -q arm64 && NUT_AI_JDK_ARCH=aarch64 NUT_AI_JDK_SHA=78b08c7f5a0598242d5719c022e19479cb4a3aa45c37c19726a757a469ed1c15 || NUT_AI_JDK_ARCH=x64 NUT_AI_JDK_SHA=868f5c672b3389fdbe48e44f94ae170f01668b1401360944fc7159d7cc9772cc
  curl -fL --retry 3 -o ~/.nut-ai-jdk.tar.gz "https://api.adoptium.net/v3/binary/version/jdk-17.0.21%2B9/mac/$NUT_AI_JDK_ARCH/jdk/hotspot/normal/eclipse"
  echo "$NUT_AI_JDK_SHA  $HOME/.nut-ai-jdk.tar.gz" | shasum -a 256 -c - && mkdir -p ~/.nut-ai-jdk && tar -xzf ~/.nut-ai-jdk.tar.gz -C ~/.nut-ai-jdk && "$HOME/.nut-ai-jdk/jdk-17.0.21+9/Contents/Home/bin/java" -version 2>&1 </dev/null | grep -Eq 'version "17[."]' && echo "$HOME/.nut-ai-jdk/jdk-17.0.21+9/Contents/Home" > ~/.nut-ai-java-home
  rm -f ~/.nut-ai-jdk.tar.gz
fi
read -r JAVA_HOME < ~/.nut-ai-java-home && export JAVA_HOME
"$JAVA_HOME/bin/java" -version
[ -x "$JAVA_HOME/bin/javac" ] && "$JAVA_HOME/bin/java" -version 2>&1 | grep -Eq 'version "(1[7-9]|2[01])[."]' || { echo 'No JDK 17 to 21 is ready. Install the Temurin 17 JDK from adoptium.net, then run this step again.'; false; }