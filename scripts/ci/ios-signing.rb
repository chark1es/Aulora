require "xcodeproj"

project = Xcodeproj::Project.open("apps/mobile/ios/Aulora.xcodeproj")
target = project.targets.find { |item| item.name == "Aulora" }
raise "Aulora target missing" unless target
config = target.build_configurations.find { |item| item.name == "Release" }
{
  "CODE_SIGN_STYLE" => "Manual",
  "CODE_SIGN_IDENTITY" => ENV.fetch("APPLE_SIGNING_IDENTITY"),
  "DEVELOPMENT_TEAM" => ENV.fetch("APPLE_TEAM_ID"),
  "PROVISIONING_PROFILE_SPECIFIER" => ENV.fetch("IOS_PROFILE_UUID"),
  "CODE_SIGN_ENTITLEMENTS" => ENV.fetch("IOS_ENTITLEMENTS_PATH"),
  "MARKETING_VERSION" => ENV.fetch("RELEASE_VERSION"),
  "CURRENT_PROJECT_VERSION" => ENV.fetch("BUILD_NUMBER"),
}.each { |key, value| config.build_settings[key] = value }

# Ship source-license and dependency notices inside the signed application.
legal = project.main_group.new_file("Aulora/Legal")
legal.last_known_file_type = "folder"
target.resources_build_phase.add_file_reference(legal)
project.save

# Expo's checked-in Info.plist uses literal version strings.
info = "apps/mobile/ios/Aulora/Info.plist"
[["CFBundleShortVersionString", ENV.fetch("RELEASE_VERSION")], ["CFBundleVersion", ENV.fetch("BUILD_NUMBER")]].each do |key, value|
  system("/usr/libexec/PlistBuddy", "-c", "Set :#{key} #{value}", info, exception: true)
end
