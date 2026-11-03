{ read -r JAVA_HOME < ~/.nut-ai-java-home && [ -x "$JAVA_HOME/bin/javac" ]; } || { echo 'Run the Install Java 17 step first. It picks the Java this build needs.'; JAVA_HOME=/run-the-Install-Java-17-step-first; }
export JAVA_HOME
export GRADLE_OPTS="\"-Dorg.gradle.java.home=$JAVA_HOME\""
[ -n "$ANDROID_HOME$ANDROID_SDK_ROOT" ] || [ ! -d "$HOME/Library/Android/sdk" ] || export ANDROID_HOME="$HOME/Library/Android/sdk"
"${ANDROID_HOME:-$ANDROID_SDK_ROOT}/platform-tools/adb" shell getprop ro.product.cpu.abilist 2>/dev/null | tr ', \r' '\n\n\n' | grep -m 1 -x -E 'armeabi-v7a|arm64-v8a|x86|x86_64' > ~/.nut-ai-abi
read -r ORG_GRADLE_PROJECT_reactNativeArchitectures < ~/.nut-ai-abi || ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a
export ORG_GRADLE_PROJECT_reactNativeArchitectures
./gradlew help