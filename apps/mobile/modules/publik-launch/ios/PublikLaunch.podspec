Pod::Spec.new do |s|
  s.name           = 'PublikLaunch'
  s.version        = '1.0.0'
  s.summary        = 'Launch values and the self-test line of the publik module'
  s.description    = 'Reads PUBLIK_* launch values (environment or launch argument), prints the publik self-test line and exits.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'Nut AI'
  s.homepage       = 'https://github.com/Blueturboguy07/nut-ai'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Blueturboguy07/nut-ai.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
