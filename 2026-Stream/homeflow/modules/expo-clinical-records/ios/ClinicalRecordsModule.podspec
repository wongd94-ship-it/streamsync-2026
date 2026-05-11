Pod::Spec.new do |s|
  s.name           = 'ClinicalRecordsModule'
  s.version        = '0.1.0'
  s.summary        = 'Expo module for Apple Health Clinical Records (FHIR)'
  s.description    = 'Queries HKClinicalRecord types and returns raw FHIR R4 JSON payloads.'
  s.homepage       = 'https://github.com/wongd94-ship-it/streamsync-2026'
  s.license        = { type: 'MIT' }
  s.author         = 'Streamsync Research Consortium'
  s.source         = { git: '' }

  s.platform       = :ios, '16.0'
  s.swift_version  = '5.9'

  s.source_files   = '**/*.swift'
  s.frameworks     = 'HealthKit'

  s.dependency 'ExpoModulesCore'
end
