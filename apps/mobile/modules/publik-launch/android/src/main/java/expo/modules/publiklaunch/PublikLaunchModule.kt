package expo.modules.publiklaunch

import android.content.pm.ApplicationInfo
import android.os.Process
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The native half of the publik module's launch switches (modules/publik-launch/index.ts). */
class PublikLaunchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PublikLaunch")

    // A string extra of the launching intent: `adb shell am start -n com.nutai.app/.MainActivity -e <NAME> <value>`.
    // Any app on the phone can put extras on an intent, so only a debuggable build (the CI test APK) reads them.
    Function("value") { name: String ->
      val debuggable = appContext.reactContext?.applicationInfo?.let { (it.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0 } ?: false
      if (debuggable) appContext.currentActivity?.intent?.getStringExtra(name)?.takeIf { it.isNotEmpty() } else null
    }

    // The self-test line: stdout (logcat tag System.out) and logcat tag "publik".
    Function("printLine") { line: String ->
      println(line)
      Log.i("publik", line)
      Unit
    }

    Function("exit") {
      appContext.currentActivity?.finishAffinity()
      Process.killProcess(Process.myPid())
    }
  }
}
