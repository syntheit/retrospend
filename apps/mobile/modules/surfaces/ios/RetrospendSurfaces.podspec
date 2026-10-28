Pod::Spec.new do |s|
  s.name           = 'RetrospendSurfaces'
  s.version        = '0.1.0'
  s.summary        = 'Share, Shortcuts and Controls hand-off for Retrospend.'
  s.description    = 'Reads what the share extension and the App Intents left in the App Group.'
  s.license        = 'MIT'
  s.author         = 'Retrospend'
  s.homepage       = 'https://retrospend.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
