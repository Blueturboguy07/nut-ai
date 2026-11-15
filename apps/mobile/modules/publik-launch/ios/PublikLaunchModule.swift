import ExpoModulesCore
import Foundation
import StoreKit

/// The native half of the publik module's launch switches (modules/publik-launch/index.ts).
/// Compiled with PUBLIK_TEST_HOOKS only in a CI test build: a release build reads no launch value.
public class PublikLaunchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PublikLaunch")

    // An environment variable of this launch (`SIMCTL_CHILD_<NAME>=... xcrun simctl launch`),
    // else a launch argument (`-<NAME> <value>`, which iOS puts in the argument domain of UserDefaults).
    // Only Xcode, simctl or a debugger can set either one; no other app can, and saved defaults are not read.
    Function("value") { (name: String) -> String? in
      #if PUBLIK_TEST_HOOKS
      if let env = ProcessInfo.processInfo.environment[name], !env.isEmpty {
        return env
      }
      let args = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
      if let arg = args[name] as? String, !arg.isEmpty {
        return arg
      }
      #endif
      return nil
    }

    // The self-test line, on stdout (`xcrun simctl launch --console-pty` shows it).
    Function("printLine") { (line: String) in
      #if PUBLIK_TEST_HOOKS
      FileHandle.standardOutput.write(Data((line + "\n").utf8))
      #endif
    }

    Function("exit") { () -> Void in
      #if PUBLIK_TEST_HOOKS
      Darwin.exit(0)
      #endif
    }

    // Every build: the App Store storefront country (ISO 3166-1 alpha-3, "USA"), or nil.
    // An App Store build shows links that sell a publik plan only on a real
    // device in the US storefront. A simulator reports the US storefront too
    // (blind test round 2, Nov 15 2026, N1), so a simulator answers nil: unknown.
    AsyncFunction("storefrontCountry") { () async -> String? in
      #if targetEnvironment(simulator)
      return nil
      #else
      return await Storefront.current?.countryCode
      #endif
    }

    // Every build: true on a simulator.
    Function("isSimulator") { () -> Bool in
      #if targetEnvironment(simulator)
      return true
      #else
      return false
      #endif
    }

    // Every build: one line in the system log (the purchase-link rule at start;
    // CI reads it from the App Store build on a simulator). Never a secret.
    Function("logLine") { (line: String) in
      NSLog("%@", line)
    }
  }
}
