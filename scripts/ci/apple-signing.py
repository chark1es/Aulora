"""Install and remove release signing material on an ephemeral macOS runner."""
import base64
import datetime
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import sys
import urllib.request

ROOT = Path(os.environ["RUNNER_TEMP"]) / "aulora-signing"
KEYCHAIN = ROOT / "release.keychain-db"


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def private_file(path, data):
    path.write_bytes(data)
    path.chmod(0o600)


def install():
    for name in ("APPLE_CERTIFICATE_BASE64", "APPLE_CERTIFICATE_PASSWORD", "APPLE_TEAM_ID", "APPLE_SIGNING_IDENTITY"):
        if not os.environ.get(name):
            raise ValueError(f"Missing Actions secret: {name}")
    ROOT.mkdir(mode=0o700, exist_ok=True)
    certificate = ROOT / "certificate.p12"
    private_file(certificate, base64.b64decode(os.environ["APPLE_CERTIFICATE_BASE64"], validate=True))
    password = secrets.token_urlsafe(32)
    run("security", "create-keychain", "-p", password, str(KEYCHAIN))
    run("security", "set-keychain-settings", "-lut", "21600", str(KEYCHAIN))
    run("security", "unlock-keychain", "-p", password, str(KEYCHAIN))
    platform = os.environ["SIGNING_PLATFORM"]
    intermediate_name = "DeveloperIDG2CA.cer" if platform == "macos" else "AppleWWDRCAG3.cer"
    intermediate = ROOT / intermediate_name
    with urllib.request.urlopen("https://www.apple.com/certificateauthority/" + intermediate_name, timeout=60) as response:
        private_file(intermediate, response.read())
    run("security", "import", str(intermediate), "-k", str(KEYCHAIN), "-t", "cert")
    run("security", "import", str(certificate), "-k", str(KEYCHAIN), "-P", os.environ["APPLE_CERTIFICATE_PASSWORD"], "-T", "/usr/bin/codesign", "-T", "/usr/bin/security")
    run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, str(KEYCHAIN))
    original = re.findall(r'"([^"\n]+)"', run("security", "list-keychains", "-d", "user").decode())
    run("security", "list-keychains", "-d", "user", "-s", str(KEYCHAIN), *original)
    identities = run("security", "find-identity", "-v", "-p", "codesigning", str(KEYCHAIN)).decode()
    if os.environ["APPLE_SIGNING_IDENTITY"] not in identities:
        raise ValueError("The imported certificate does not match the configured signing identity")
    exports = {"APPLE_SIGNING_IDENTITY": os.environ["APPLE_SIGNING_IDENTITY"]}
    if platform == "ios":
        profile = ROOT / "release.mobileprovision"
        private_file(profile, base64.b64decode(os.environ["IOS_PROFILE_BASE64"], validate=True))
        info = plistlib.loads(run("security", "cms", "-D", "-i", str(profile)))
        team = os.environ["APPLE_TEAM_ID"]
        if info["Entitlements"]["application-identifier"] != team + ".dev.spwnd.aulora":
            raise ValueError("Provisioning profile has the wrong team or bundle ID")
        if info["ExpirationDate"] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
            raise ValueError("Provisioning profile has expired")
        if info["Entitlements"].get("aps-environment") != "production" or info["Entitlements"].get("get-task-allow"):
            raise ValueError("An App Store profile with production push is required")
        if "ProvisionedDevices" in info or info.get("ProvisionsAllDevices"):
            raise ValueError("Use an App Store distribution profile")
        for directory in (Path.home() / "Library/MobileDevice/Provisioning Profiles", Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles"):
            directory.mkdir(parents=True, exist_ok=True)
            private_file(directory / (info["UUID"] + ".mobileprovision"), profile.read_bytes())
        private_file(ROOT / "profile-uuid.txt", info["UUID"].encode())
        entitlements = plistlib.loads(Path("apps/mobile/ios/Aulora/Aulora.entitlements").read_bytes())
        entitlements["aps-environment"] = "production"
        private_file(ROOT / "Release.entitlements", plistlib.dumps(entitlements))
        options = {"method": "app-store-connect", "destination": "export", "teamID": team, "signingStyle": "manual", "signingCertificate": os.environ["APPLE_SIGNING_IDENTITY"], "provisioningProfiles": {"dev.spwnd.aulora": info["UUID"]}, "manageAppVersionAndBuildNumber": False}
        private_file(ROOT / "ExportOptions.plist", plistlib.dumps(options))
        exports.update({"IOS_PROFILE_UUID": info["UUID"], "IOS_ENTITLEMENTS_PATH": str(ROOT / "Release.entitlements"), "IOS_EXPORT_OPTIONS_PATH": str(ROOT / "ExportOptions.plist")})
    with open(os.environ["GITHUB_ENV"], "a") as output:
        for name, value in exports.items():
            if "\n" in value or "\r" in value:
                raise ValueError("Invalid signing metadata")
            output.write(name + "=" + value + "\n")
    print("Release identity installed in a temporary keychain.")


def cleanup():
    if KEYCHAIN.exists():
        subprocess.run(["security", "delete-keychain", str(KEYCHAIN)], check=True)
    uuid_file = ROOT / "profile-uuid.txt"
    if uuid_file.exists():
        uuid = uuid_file.read_text().strip()
        for directory in ("Library/MobileDevice/Provisioning Profiles", "Library/Developer/Xcode/UserData/Provisioning Profiles"):
            (Path.home() / directory / (uuid + ".mobileprovision")).unlink(missing_ok=True)
    import shutil
    shutil.rmtree(ROOT, ignore_errors=True)


if __name__ == "__main__":
    try:
        if sys.argv[1] == "install":
            install()
        elif sys.argv[1] == "cleanup":
            cleanup()
        else:
            raise ValueError("Use install or cleanup")
    except Exception as error:
        # A subprocess command may contain passwords. Never print its arguments.
        print("Apple signing setup failed: " + (str(error) if not isinstance(error, subprocess.CalledProcessError) else "security command failed"), file=sys.stderr)
        sys.exit(1)
