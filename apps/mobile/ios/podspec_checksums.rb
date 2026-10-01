require 'digest'

# ExpoModulesCore's precompiled podspec embeds absolute file:// and prepare
# paths. CocoaPods hashes that generated JSON, making an unchanged dependency
# look different on another checkout. Preserve all spec content except the
# checkout prefix when computing its checksum; the installed paths stay intact.
module AuloraPodspecChecksums
  def store_podspec(name, *args)
    spec = super
    if name == 'ExpoModulesCore' && spec.defined_in_file.to_s.end_with?('.podspec.json')
      checkout_root = File.expand_path('../../..', Pod::Config.instance.installation_root)
      content = File.read(spec.defined_in_file).gsub(checkout_root, '${AULORA_ROOT}')
      spec.instance_variable_set(:@checksum, Digest::SHA1.hexdigest(content))
    end
    spec
  end
end
