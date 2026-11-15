package expo.modules.publiklaunch

import android.os.Process
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The native half of the publik module's launch switches (modules/publik-launch/index.ts).
 * BuildConfig.PUBLIK_TEST_HOOKS is true only in a CI test build: a release build
 * reads no intent extra, so an exported activity forwards nothing to the module.
 */
class PublikLaunchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PublikLaunch")

    // A string extra of the launching intent: `adb shell am start -n com.nutai.app/.MainActivity -e <NAME> <value>`.
    Function("value") { name: String ->
      if (BuildConfig.PUBLIK_TEST_HOOKS) appContext.currentActivity?.intent?.getStringExtra(name)?.takeIf { it.isNotEmpty() } else null
    }

    // The self-test line: stdout (logcat tag System.out) and logcat tag "publik".
    Function("printLine") { line: String ->
      if (BuildConfig.PUBLIK_TEST_HOOKS) {
        println(line)
        Log.i("publik", line)
      }
      Unit
    }

    Function("exit") {
      if (BuildConfig.PUBLIK_TEST_HOOKS) {
        appContext.currentActivity?.finishAffinity()
        Process.killProcess(Process.myPid())
      }
      Unit
    }

    // No App Store on Android: no storefront (the JS reads "" as none).
    Function("storefrontCountry") {
      ""
    }
  }
}
