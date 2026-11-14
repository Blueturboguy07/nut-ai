Pod::Spec.new do |s|
  s.name           = 'PublikLaunch'
  s.version        = '1.0.0'
  s.summary        = 'Launch values and the self-test line of the publik module (test builds only)'
  s.description    = 'Reads PUBLIK_* launch values (environment or launch argument), prints the publik self-test line and exits. Compiled in only when PUBLIK_TEST_HOOKS=1 at pod install.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'Nut AI'
  s.homepage       = 'https://github.com/Blueturboguy07/nut-ai'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Blueturboguy07/nut-ai.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  # A CI test build only (`PUBLIK_TEST_HOOKS=1 pod install`). Without it the
  # module reads no launch value at all.
  xcconfig['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) PUBLIK_TEST_HOOKS' if ENV['PUBLIK_TEST_HOOKS'] == '1'
  s.pod_target_xcconfig = xcconfig
end
