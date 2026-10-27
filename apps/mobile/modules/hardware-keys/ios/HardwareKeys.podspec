Pod::Spec.new do |s|
  s.name           = 'HardwareKeys'
  s.version        = '0.1.0'
  s.summary        = 'Hardware keyboard shortcuts for the iPad (Cmd+N, Cmd+F).'
  s.description    = 'Registers UIKeyCommands on the root view controller and reports them to JS.'
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
