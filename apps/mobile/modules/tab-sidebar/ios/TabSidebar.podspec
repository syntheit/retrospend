Pod::Spec.new do |s|
  s.name           = 'TabSidebar'
  s.version        = '0.1.0'
  s.summary        = 'Sidebar-only tabs and a sidebar group for the iPad tab bar.'
  s.description    = 'Keeps some native tabs in the iPadOS sidebar only and groups them under a heading.'
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
