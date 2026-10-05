require 'fileutils'
require 'tmpdir'
require_relative '../../apps/mobile/ios/podspec_checksums'

module Pod
  class Config
    class << self
      attr_accessor :installation_root

      def instance
        self
      end
    end
  end
end

class Specification
  attr_reader :defined_in_file, :checksum

  def initialize(path)
    @defined_in_file = path
    @checksum = 'upstream-checksum'
  end
end

class Sandbox
  def initialize(spec_path)
    @spec_path = spec_path
  end

  def store_podspec(_name, *args)
    Specification.new(@spec_path)
  end
end

Sandbox.prepend(AuloraPodspecChecksums)

Dir.mktmpdir('aulora-podspec-') do |directory|
  check = lambda do |checkout, name = 'ExpoModulesCore', version = '57.0.19'|
    root = File.join(directory, checkout)
    ios = File.join(root, 'apps/mobile/ios')
    spec_path = File.join(ios, 'Pods/Local Podspecs/ExpoModulesCore.podspec.json')
    FileUtils.mkdir_p(File.dirname(spec_path))
    content = <<~JSON
      {"name":"#{name}","version":"#{version}","source":{"http":"file://#{root}/node_modules/expo-modules-core/prebuilds/core.tar.gz"},"prepare_command":"#{root}/node_modules/expo-modules-core/prebuilds/core.tar.gz"}
    JSON
    File.write(spec_path, content)
    Pod::Config.installation_root = ios
    checksum = Sandbox.new(spec_path).store_podspec(name).checksum
    raise 'Installed spec paths changed' unless File.read(spec_path) == content
    checksum
  end

  local = check.call('local-checkout')
  runner = check.call('github-runner')
  raise 'Checksum changed after relocating checkout' unless local == runner
  raise 'Expected a SHA-1 checksum' unless local.match?(/\A[a-f0-9]{40}\z/)
  raise 'Dependency change was ignored' if check.call('github-runner', 'ExpoModulesCore', '57.0.20') == local
  raise 'Unrelated pod checksum was overridden' unless check.call('github-runner', 'OtherPod') == 'upstream-checksum'
end

puts 'Portable podspec checksum regression passed; dependency changes remain detectable.'
