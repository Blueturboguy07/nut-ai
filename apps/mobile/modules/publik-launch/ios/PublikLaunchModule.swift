import ExpoModulesCore
import Foundation

/// The native half of the publik module's launch switches (modules/publik-launch/index.ts).
public class PublikLaunchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PublikLaunch")

    // An environment variable of this launch (`SIMCTL_CHILD_<NAME>=... xcrun simctl launch`),
    // else a launch argument (`-<NAME> <value>`, which iOS puts in the argument domain of UserDefaults).
    // Only Xcode, simctl or a debugger can set either one; no other app can, and saved defaults are not read.
    Function("value") { (name: String) -> String? in
      if let env = ProcessInfo.processInfo.environment[name], !env.isEmpty {
        return env
      }
      let args = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
      if let arg = args[name] as? String, !arg.isEmpty {
        return arg
      }
      return nil
    }

    // The self-test line, on stdout (`xcrun simctl launch --console-pty` shows it).
    Function("printLine") { (line: String) in
      FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }

    Function("exit") { () -> Void in
      Darwin.exit(0)
    }
  }
}
