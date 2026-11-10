"""Screenshot a page with headless Chrome.

  python tools/screenshot.py [page] [out.png] [--width 1700 --height 900]

page defaults to tests/screens.html on a temporary dev server; anything else that is
not a full URL is a path on it (e.g. /tests/run.html). Those pages run in real time and
the picture is taken --wait ms after they start (the dev server's /dev/shot holds the
page's load event back that long). A full http(s) URL is used as is (start
tools/dev_server.py yourself) and gets --wait ms of Chrome's virtual time instead.
"""
import argparse
import os
import subprocess
import sys
import tempfile
import threading
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dev_server  # noqa: E402

CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page", nargs="?", default="/tests/screens.html")
    ap.add_argument("out", nargs="?", default="screenshot.png")
    ap.add_argument("--width", type=int, default=1700)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--wait", type=int, default=6000, help="ms to let the page work before the picture")
    a = ap.parse_args()

    url = a.page
    timing = ["--virtual-time-budget=%d" % a.wait]
    if not url.startswith("http"):
        os.environ.setdefault("DEV_SERVER_QUIET", "1")
        srv = dev_server.make_server(0)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = "http://127.0.0.1:%d/dev/shot?%s" % (srv.server_address[1],
                                                   urlencode({"page": "/" + url.lstrip("/"), "ms": a.wait}))
        timing = []
    out = os.path.abspath(a.out)
    with tempfile.TemporaryDirectory() as profile:
        cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
               "--no-default-browser-check", "--user-data-dir=" + profile,
               "--hide-scrollbars", *timing,
               "--window-size=%d,%d" % (a.width, a.height),
               "--screenshot=" + out, url]
        res = subprocess.run(cmd, capture_output=True, timeout=120)
    if not os.path.isfile(out):
        print(res.stderr.decode("utf-8", "replace"))
        return 1
    print("Saved", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
