"""Local dev server for the wedding site.

  python tools/dev_server.py [--port 8080]

  /                 public/
  /site-config.js   the real file + tests/dev-overrides.js appended
  /tests/*          tests/
  /apps-script/*    apps-script/ (.gs served as JavaScript)
  POST /sheet-api   the Apps Script `sheet` request, answered from tests/sheet/{tab}.csv (tools/mock_sheet.py)
  POST /mock-api, GET /mock-api/img/{id}   tools/mock_gallery.py
  GET /gallery/gallery.js  page switches: break=load (404), break=mount (mount throws),
                    break=once&k=KEY (404 the first time for that KEY), break=show (the
                    page's first show() throws, after the real one ran)
  POST /tests/result  the test page's log (tests/harness.js); run_tests.py waits for it
  GET /dev/shot?page=P&ms=N   P full-window, plus a picture held back N ms, so a headless
                              screenshot (taken at page load) happens N ms later (screenshot.py)
"""
import argparse
import base64
import html
import mimetypes
import os
import queue
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
PUBLIC = os.path.join(ROOT, "public")
TESTS = os.path.join(ROOT, "tests")
APPS_SCRIPT = os.path.join(ROOT, "apps-script")

import mock_gallery  # noqa: E402
import mock_sheet  # noqa: E402

# Logs posted by the test page; tools/run_tests.py reads them.
RESULTS = queue.Queue()
HOLD_MAX_MS = 60000
GIF_1PX = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==")  # 1x1 clear GIF

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".gs")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/csv", ".csv")


# Stands in for gallery/gallery.js when a page asks for break=mount.
BROKEN_MOUNT = (b'(function(){self.WeddingGallery=self.WeddingGallery||{};'
                b'self.WeddingGallery.mount=function(){throw new Error("stub mount failure");};})();')
# Appended to the real gallery/gallery.js for break=show: the page's first show() runs, then throws.
SHOW_FAILS_ONCE = (b'\n;(function(){var W=self.WeddingGallery,mount=W.mount;W.mount=function(box,ctx){'
                   b'var g=mount(box,ctx),show=g.show;g.show=function(){show.apply(g,arguments);'
                   b'if(!self.devShowBroke){self.devShowBroke=true;throw new Error("stub show failure");}};'
                   b'return g;};})();\n')
ONCE_SEEN = set()   # break=once: page keys whose first gallery.js request already failed
ONCE_LOCK = threading.Lock()


def flat(qs):
    return {k: v[0] for k, v in parse_qs(qs, keep_blank_values=True).items()}


def safe_join(base, rel):
    """File path inside base, or None if it escapes base."""
    p = os.path.normpath(os.path.join(base, rel))
    if p == base or p.startswith(base + os.sep):
        return p
    return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("DEV_SERVER_QUIET") != "1":
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    # -- helpers
    def send(self, status, headers, body):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def query(self):
        """Request query plus "_page": the query of the page that sent the request."""
        q = flat(urlsplit(self.path).query)
        q["_page"] = flat(urlsplit(self.headers.get("Referer", "")).query)
        return q

    def mock(self, fn):
        """Run a stand-in backend call; a crash inside it becomes a 500 with the traceback."""
        try:
            s, h, b = fn()
        except Exception:
            traceback.print_exc()
            return self.send(500, {"Content-Type": "text/plain"}, b"stand-in backend crashed (see dev server console)")
        return self.send(s, h, b)

    def send_file(self, path):
        if not path or not os.path.isfile(path):
            return self.send(404, {"Content-Type": "text/plain"}, b"not found")
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(path, "rb") as f:
            self.send(200, {"Content-Type": ctype}, f.read())

    # -- routes
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/site-config.js":
            return self.site_config()
        if path in ("/dev/hold", "/dev/shot"):
            return self.shot(path)
        if path.startswith("/mock-api/img/"):
            return self.mock(lambda: mock_gallery.handle_img(path[len("/mock-api/img/"):], self.query()))
        for prefix, base in (("/tests/", TESTS), ("/apps-script/", APPS_SCRIPT)):
            if path.startswith(prefix):
                return self.send_file(safe_join(base, path[len(prefix):]))
        rel = path.lstrip("/") or "index.html"
        if rel == "gallery/gallery.js":
            # Test switches from the page query (see the top of this file); product code has no hooks.
            page = self.query()["_page"]
            brk = page.get("break")
            if brk == "once":
                with ONCE_LOCK:
                    first = page.get("k", "") not in ONCE_SEEN
                    ONCE_SEEN.add(page.get("k", ""))
                if first:
                    return self.send(404, {"Content-Type": "text/plain"}, b"not found")
            if brk == "load":
                return self.send(404, {"Content-Type": "text/plain"}, b"not found")
            if brk == "mount":
                return self.send(200, {"Content-Type": "application/javascript; charset=utf-8"}, BROKEN_MOUNT)
            if brk == "show":
                with open(os.path.join(PUBLIC, "gallery", "gallery.js"), "rb") as f:
                    return self.send(200, {"Content-Type": "application/javascript; charset=utf-8"},
                                     f.read() + SHOW_FAILS_ONCE)
        target = safe_join(PUBLIC, rel)
        if target and os.path.isdir(target):
            target = os.path.join(target, "index.html")
        self.send_file(target)

    do_HEAD = do_GET

    def do_POST(self):
        path = urlsplit(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        if path == "/mock-api":
            return self.mock(lambda: mock_gallery.handle_api(self.query(), body, self.headers))
        if path == "/sheet-api":
            return self.mock(lambda: mock_sheet.handle_sheet(self.query(), body))
        if path == "/tests/result":
            RESULTS.put(body.decode("utf-8", "replace"))
            return self.send(204, {}, b"")
        self.send(404, {"Content-Type": "text/plain"}, b"not found")

    def shot(self, path):
        q = flat(urlsplit(self.path).query)
        try:
            ms = max(0, min(int(q.get("ms", "0")), HOLD_MAX_MS))
        except ValueError:
            ms = 0
        if path == "/dev/hold":
            time.sleep(ms / 1000)
            return self.send(200, {"Content-Type": "image/gif"}, GIF_1PX)
        page = html.escape(q.get("page", "/"), quote=True)
        body = ('<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;border:0;'
                'width:100%%;height:100%%;display:block}</style><iframe src="%s"></iframe>'
                '<img src="/dev/hold?ms=%d" alt="" style="position:absolute;width:1px;height:1px">' % (page, ms))
        return self.send(200, {"Content-Type": "text/html; charset=utf-8"}, body.encode())

    def site_config(self):
        with open(os.path.join(PUBLIC, "site-config.js"), "rb") as f:
            real = f.read()
        with open(os.path.join(TESTS, "dev-overrides.js"), "rb") as f:
            extra = f.read()
        self.send(200, {"Content-Type": "application/javascript; charset=utf-8"},
                  real + b"\n;\n" + extra)


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # A page that went away mid-request (an iframe removed by a test) is not an error.
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def make_server(port):
    return Server(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()
    srv = make_server(args.port)
    print("Dev server on http://127.0.0.1:%d/" % srv.server_address[1])
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
