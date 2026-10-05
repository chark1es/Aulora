"""Install and remove release signing material on an ephemeral macOS runner."""
import base64
import datetime
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = Path(os.environ["RUNNER_TEMP"]) / "aulora-signing"
KEYCHAIN = ROOT / "release.keychain-db"
APPLE_CA_BASE = "https://www.apple.com/certificateauthority/"
BUNDLE_ID = "dev.spwnd.aulora"

# Absolute paths for external tools, resolved once so a malicious PATH entry
# cannot substitute the executables this script trusts.
SECURITY = shutil.which("security") or "/usr/bin/security"


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def private_file(path, data):
    path.write_bytes(data)
    path.chmod(0o600)


def download_certificate(name):
    url = urllib.parse.urljoin(APPLE_CA_BASE, name)
    if urllib.parse.urlparse(url).scheme != "https":
        raise ValueError("Refusing to download intermediate certificates over a non-HTTPS URL")
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def create_keychain(password):
    run(SECURITY, "create-keychain", "-p", password, str(KEYCHAIN))
    run(SECURITY, "set-keychain-settings", "-lut", "21600", str(KEYCHAIN))
    run(SECURITY, "unlock-keychain", "-p", password, str(KEYCHAIN))


def import_identity(certificate, password):
    platform = os.environ["SIGNING_PLATFORM"]
    intermediate_name = "DeveloperIDG2CA.cer" if platform == "macos" else "AppleWWDRCAG3.cer"
    intermediate = ROOT / intermediate_name
    private_file(intermediate, download_certificate(intermediate_name))
    run(SECURITY, "import", str(intermediate), "-k", str(KEYCHAIN), "-t", "cert")
    run(
        SECURITY,
        "import",
        str(certificate),
        "-k",
        str(KEYCHAIN),
        "-P",
        os.environ["APPLE_CERTIFICATE_PASSWORD"],
        "-T",
        "/usr/bin/codesign",
        "-T",
        SECURITY,
    )
    run(
        SECURITY,
        "set-key-partition-list",
        "-S",
        "apple-tool:,apple:,codesign:",
        "-s",
        "-k",
        password,
        str(KEYCHAIN),
    )
    original = re.findall(
        r'"([^"\n]+)"', run(SECURITY, "list-keychains", "-d", "user").decode()
    )
    run(SECURITY, "list-keychains", "-d", "user", "-s", str(KEYCHAIN), *original)
    identities = run(
        SECURITY, "find-identity", "-v", "-p", "codesigning", str(KEYCHAIN)
    ).decode()
    if os.environ["APPLE_SIGNING_IDENTITY"] not in identities:
        raise ValueError("The imported certificate does not match the configured signing identity")


def install_profile():
    platform = os.environ["SIGNING_PLATFORM"]
    if platform != "ios":
        return {}
    profile = ROOT / "release.mobileprovision"
    private_file(profile, base64.b64decode(os.environ["IOS_PROFILE_BASE64"], validate=True))
    info = plistlib.loads(run(SECURITY, "cms", "-D", "-i", str(profile)))
    team = os.environ["APPLE_TEAM_ID"]
    if info["Entitlements"]["application-identifier"] != team + "." + BUNDLE_ID:
        raise ValueError("Provisioning profile has the wrong team or bundle ID")
    if info["ExpirationDate"] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
        raise ValueError("Provisioning profile has expired")
    if info["Entitlements"].get("aps-environment") != "production" or info["Entitlements"].get(
        "get-task-allow"
    ):
        raise ValueError("An App Store profile with production push is required")
    if "ProvisionedDevices" in info or info.get("ProvisionsAllDevices"):
        raise ValueError("Use an App Store distribution profile")
    for directory in (
        Path.home() / "Library/MobileDevice/Provisioning Profiles",
        Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
    ):
        directory.mkdir(parents=True, exist_ok=True)
        private_file(directory / (info["UUID"] + ".mobileprovision"), profile.read_bytes())
    private_file(ROOT / "profile-uuid.txt", info["UUID"].encode())
    entitlements = plistlib.loads(Path("apps/mobile/ios/Aulora/Aulora.entitlements").read_bytes())
    entitlements["aps-environment"] = "production"
    private_file(ROOT / "Release.entitlements", plistlib.dumps(entitlements))
    options = {
        "method": "app-store-connect",
        "destination": "export",
        "teamID": team,
        "signingStyle": "manual",
        "signingCertificate": os.environ["APPLE_SIGNING_IDENTITY"],
        "provisioningProfiles": {BUNDLE_ID: info["UUID"]},
        "manageAppVersionAndBuildNumber": False,
    }
    private_file(ROOT / "ExportOptions.plist", plistlib.dumps(options))
    return {
        "IOS_PROFILE_UUID": info["UUID"],
        "IOS_ENTITLEMENTS_PATH": str(ROOT / "Release.entitlements"),
        "IOS_EXPORT_OPTIONS_PATH": str(ROOT / "ExportOptions.plist"),
    }


def install():
    for name in (
        "APPLE_CERTIFICATE_BASE64",
        "APPLE_CERTIFICATE_PASSWORD",
        "APPLE_TEAM_ID",
        "APPLE_SIGNING_IDENTITY",
    ):
        if not os.environ.get(name):
            raise ValueError(f"Missing Actions secret: {name}")
    ROOT.mkdir(mode=0o700, exist_ok=True)
    certificate = ROOT / "certificate.p12"
    private_file(
        certificate,
        base64.b64decode(os.environ["APPLE_CERTIFICATE_BASE64"], validate=True),
    )
    password = secrets.token_urlsafe(32)
    create_keychain(password)
    import_identity(certificate, password)
    exports = {"APPLE_SIGNING_IDENTITY": os.environ["APPLE_SIGNING_IDENTITY"]}
    exports.update(install_profile())
    with open(os.environ["GITHUB_ENV"], "a") as output:
        for name, value in exports.items():
            if "\n" in value or "\r" in value:
                raise ValueError("Invalid signing metadata")
            output.write(name + "=" + value + "\n")
    print("Release identity installed in a temporary keychain.")


def cleanup():
    if KEYCHAIN.exists():
        subprocess.run([SECURITY, "delete-keychain", str(KEYCHAIN)], check=True)
    uuid_file = ROOT / "profile-uuid.txt"
    if uuid_file.exists():
        uuid = uuid_file.read_text().strip()
        for directory in (
            "Library/MobileDevice/Provisioning Profiles",
            "Library/Developer/Xcode/UserData/Provisioning Profiles",
        ):
            (Path.home() / directory / (uuid + ".mobileprovision")).unlink(missing_ok=True)
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
        print(
            "Apple signing setup failed: "
            + (
                str(error)
                if not isinstance(error, subprocess.CalledProcessError)
                else "security command failed"
            ),
            file=sys.stderr,
        )
        sys.exit(1)
