"""Capture the staged native screens at each device's real resolution."""
import argparse
import shutil
import subprocess
import time
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[2]
VIEWS = [
    ("general", "01-channels.png"),
    ("design", "02-design.png"),
    ("direct", "03-direct-messages.png"),
    ("thread", "04-threads.png"),
    ("group", "05-group-conversations.png"),
]

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--iphone")
parser.add_argument("--ipad")
parser.add_argument("--phone")
parser.add_argument("--tablet-7")
parser.add_argument("--tablet-10")
parser.add_argument("--adb", default="adb")
parser.add_argument("--settle", type=float, default=20, help="Seconds to let each native launch render before capture")
parser.add_argument("--views", nargs="+", choices=[view for view, _ in VIEWS], help="Capture only selected views")
args = parser.parse_args()

# Resolve external tools to absolute paths so a hostile PATH entry cannot
# substitute a different program.
ADB = shutil.which(args.adb) or args.adb
XCRUN = "/usr/bin/xcrun"
devices = [
    ("ios", args.iphone, "app-store/iphone-6.9"),
    ("ios", args.ipad, "app-store/ipad-13"),
    ("android", args.phone, "google-play/phone"),
    ("android", args.tablet_7, "google-play/tablet-7"),
    ("android", args.tablet_10, "google-play/tablet-10"),
]
devices = [device for device in devices if device[1]]
if not devices:
    parser.error("Supply at least one device id.")

def run(command, **kwargs):
    # `command` is always one of the literal argument lists below; shell is
    # never used, so each element is passed as its own argument.
    return subprocess.run(command, check=True, stdout=subprocess.PIPE, **kwargs)

for view, filename in VIEWS:
    if args.views and view not in args.views:
        continue
    (ROOT / ".cache/store-capture/apps/mobile/src/lib/capture-state.ts").write_text(
        f"export const CAPTURE_VIEW: string = '{view}';\n"
    )
    # Full launches avoid leaving Metro's refresh banner over native modal screens.
    time.sleep(2)
    for platform, device, _ in devices:
        if platform == "ios":
            subprocess.run(["/usr/bin/xcrun", "simctl", "terminate", device, "dev.spwnd.aulora"], capture_output=True)
            run([XCRUN, "simctl", "launch", device, "dev.spwnd.aulora"])
        else:
            run([ADB, "-s", device, "shell", "am", "start", "-n", "dev.spwnd.aulora/.MainActivity"])
    time.sleep(args.settle)
    for platform, device, folder in devices:
        target = ROOT / ".cache/store-raw" / folder / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(7):
            if platform == "ios":
                run([XCRUN, "simctl", "io", device, "screenshot", str(target)])
            else:
                target.write_bytes(run([ADB, "-s", device, "exec-out", "screencap", "-p"]).stdout)
            with Image.open(target) as screenshot:
                rgb = screenshot.convert("RGB")
                top = rgb.crop((0, 0, rgb.width, int(rgb.height * .15)))
                loading = any(count > 100 and all(abs(a - b) < 4 for a, b in zip(color, (37, 132, 232)))
                              for count, color in top.getcolors(top.width * top.height))
                body = rgb.crop((0, int(rgb.height * .15), rgb.width, int(rgb.height * .9)))
                blank = max(ImageStat.Stat(body).stddev) < 4
            if not loading and not blank:
                break
            if attempt == 6:
                target.unlink()
                raise RuntimeError(f"{folder}/{filename} has a loading banner or blank content; capture again after the app renders")
            time.sleep(5)
        print(f"Captured {folder}/{filename}", flush=True)

# Inspect the images before exporting. Timing alone cannot prove a screen rendered.
