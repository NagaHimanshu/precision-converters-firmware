"""Run tests/run.html in headless Chrome against the dev server.

Usage: python tools/run_tests.py
The page runs in real time (photo decoding and encoding happen off the page's main
thread, which Chrome's virtual time does not wait for) and posts its log back to the
dev server when done. Exit code 0 only when the log ends "RESULT pass=N fail=0", N > 0.
"""
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dev_server  # noqa: E402

CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
WAIT_SECONDS = 240   # the whole run; each test also has its own limit in tests/harness.js


def main():
    os.environ.setdefault("DEV_SERVER_QUIET", "1")
    srv = dev_server.make_server(0)  # port 0 = any free port
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/tests/run.html" % port
    log = ""
    with tempfile.TemporaryDirectory() as profile:
        # --disable-extensions: an extension the PC's admin installs restarts the site's
        # service worker a few seconds after Chrome starts, which breaks a slow request
        # going through it (the service worker test then fails for no fault of the site).
        cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
               "--no-default-browser-check", "--disable-extensions", "--user-data-dir=" + profile,
               "--window-size=1280,900", url]
        try:
            chrome = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print("Could not run Chrome:", e)
            return 1
        try:
            log = dev_server.RESULTS.get(timeout=WAIT_SECONDS)
        except queue.Empty:
            log = ""
        finally:
            chrome.kill()
            chrome.wait(timeout=30)
    print(log.rstrip() if log else "(no result from the test page within %d s)" % WAIT_SECONDS)
    r = re.search(r"RESULT pass=(\d+) fail=(\d+)", log)
    if r and int(r.group(1)) > 0 and int(r.group(2)) == 0:
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
