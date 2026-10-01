import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const patch = fileURLToPath(new URL("../../apps/mobile/ios/podspec_checksums.rb", import.meta.url));
const ruby = `
  require ARGV[0]
  module Pod
    class Config
      def self.instance; self; end
      def self.installation_root; ARGV[1]; end
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
    def store_podspec(name, *args); Specification.new(ARGV[2]); end
  end
  Sandbox.prepend(AuloraPodspecChecksums)
  File.write(ARGV[4], Sandbox.new.store_podspec(ARGV[3]).checksum)
`;

test("Expo precompiled checksums survive checkout relocation but still detect spec changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "aulora-podspec-"));
  try {
    const check = (checkout, name = "ExpoModulesCore", version = "57.0.19") => {
      const root = join(directory, checkout);
      const ios = join(root, "apps/mobile/ios");
      const spec = join(ios, "Pods/Local Podspecs/ExpoModulesCore.podspec.json");
      mkdirSync(dirname(spec), { recursive: true });
      const content = JSON.stringify({
        name,
        version,
        source: { http: `file://${root}/node_modules/expo-modules-core/prebuilds/core.tar.gz` },
        prepare_command: `TARBALL="${root}/node_modules/expo-modules-core/prebuilds/core.tar.gz"`,
      });
      writeFileSync(spec, content);
      const result = join(root, "checksum.txt");
      execFileSync("ruby", ["-e", ruby, patch, ios, spec, name, result]);
      const checksum = readFileSync(result, "utf8");
      expect(readFileSync(spec, "utf8")).toBe(content);
      return checksum;
    };
    const local = check("local-checkout");
    const runner = check("github-runner");
    expect(local).toBe(runner);
    expect(local).toMatch(/^[a-f0-9]{40}$/);
    expect(check("github-runner", "ExpoModulesCore", "57.0.20")).not.toBe(local);
    expect(check("github-runner", "OtherPod")).toBe("upstream-checksum");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
