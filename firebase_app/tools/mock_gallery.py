"""Stand-in for the gallery backend.

dev_server.py calls handle_api and handle_img and nothing else, so this module
stays importable on its own.

`query` is a dict of the request's own query-string values (first value of each),
plus the key "_page": a dict of the query of the page that made the request (taken
from the Referer header). `mode` (from the request query) picks a behaviour:
ok, empty, down, html, slow, busy, full, paused, badthumbs,
slowupload (each upload takes 3 s), flaky (every 2nd upload from a phone fails "unavailable"),
ratelimit (every well-formed upload fails "rate_limited"),
nounlink (unlink answers an HTTP 500 error page; everything else as ok),
latethumbs (a photo uploaded in this mode has no picture, "not found", for its first
LATE_THUMB_SECONDS, like Google's thumbnail of a photo added a moment ago).
In paused and full, uploads fail with that code too. Any other mode acts like ok.
Uploaded photos are kept in memory and listed only in the mode they were sent in, so
one test's uploads don't change another mode's album.
Google sign-in: `link` accepts only the stand-in token "mock:{name}" (anything else is
"signin_failed"); phones linked with the same name share one account, like Code.gs
(Photos by me, delete and the name on uploads follow the account). `unlink` undoes it.
"""
import base64
import binascii
import io
import json
import re
import threading
import time
import unicodedata

JSON = {"Content-Type": "application/json"}
HTML = {"Content-Type": "text/html; charset=utf-8"}
HTML_PAGE = b"<!DOCTYPE html><html><body><h1>Sign in to continue</h1></body></html>"
SEED_COUNT = 45
SLOW_SECONDS = 20
BUSY_CALLS = 2
BASE_MS = 1_800_000_000_000       # newest seed photo time (ms epoch)
STEP_MS = 3_600_000               # one hour between seed photos
SHAPES = [(600, 800), (800, 600), (700, 700), (540, 960), (960, 540)]  # portrait, landscape, square
DEFAULT_WIDTH = 400
PAGE_SIZE_MAX = 60                # mirrors CONFIG.PAGE_SIZE_MAX in apps-script/Config.gs
DEVICE_PATTERN = re.compile(r"[0-9a-f]{32}")  # device code format from the contract
CURSOR_PATTERN = re.compile(r"[0-9]+")        # cursor = decimal offset; anything else = start
JPEG_MAGIC = bytes([0xFF, 0xD8, 0xFF])        # every JPEG file starts with these bytes
MAX_PHOTO_BYTES = 10485760        # mirrors CONFIG.MAX_PHOTO_BYTES in apps-script/Config.gs
NAME_MAX_LENGTH = 40              # mirrors CONFIG.NAME_MAX_LENGTH
SLOW_UPLOAD_SECONDS = 3
LATE_THUMB_SECONDS = 3            # mode latethumbs (tests/views.test.js waits for this too)
UPLOADS_KEPT = 200                # oldest stand-in uploads are forgotten past this
MOCK_TOKEN_PREFIX = "mock:"       # stand-in Google token: "mock:{name}" (see tests/fake-gis.js)

_lock = threading.Lock()
_hearts = {}      # photo id -> set of device codes that hearted it
_busy_seen = {}   # device -> number of calls answered "busy"
_img_cache = {}   # (photo id, width) -> jpeg bytes
_uploads = []     # newest first: {"id", "by", "at", "base", "owner", "mode", "data"}
_upload_seq = [0]
_flaky_seen = {}  # device -> uploads tried in mode flaky
_devices = {}     # device -> {"account", "name"}: phones linked to a (stand-in) Google account


def _seed():
    photos = []
    for i in range(SEED_COUNT):
        photos.append({
            "id": "p%03d" % i,
            "by": "" if i % 4 == 0 else "Guest %d" % (i % 7 + 1),
            "at": BASE_MS - i * STEP_MS,
            "base": (i * 5) % 9,
            "owner": "",
            "account": "",
        })
    return photos


SEED = _seed()


def _out(status, headers, obj):
    return status, dict(headers), json.dumps(obj).encode()


def _fail(code):
    return _out(200, JSON, {"ok": False, "code": code})


def _account(device):
    """The account a phone is linked to, or ""."""
    d = _devices.get(device)
    return d["account"] if d else ""


def _mine(p, device):
    """Same rule as canDelete() in apps-script/Logic.gs: same phone, or same account."""
    if device != "" and p["owner"] == device:
        return True
    account = _account(device)
    return account != "" and p.get("account", "") == account


def _photo(p, device):
    hearted = device != "" and device in _hearts.get(p["id"], set())
    return {
        "id": p["id"], "by": p["by"], "at": p["at"],
        "hearts": p["base"] + (1 if hearted else 0),
        "hearted": hearted,
        "mine": _mine(p, device),
    }


def handle_api(query, body, headers=None):
    """POST /mock-api -> (status, headers, body bytes)."""
    mode = query.get("mode", "ok")
    if mode == "down":
        return 500, dict(HTML), HTML_PAGE
    if mode == "html":
        return 200, dict(HTML), HTML_PAGE
    ctype = (headers.get("Content-Type", "") if headers is not None else "text/plain")
    if not ctype.lower().startswith("text/plain"):
        return 400, {"Content-Type": "text/plain"}, b"Content-Type must be text/plain"
    # Same rule as parseRequest() in apps-script/Logic.gs.
    try:
        req = json.loads(body.decode("utf-8"))
    except ValueError:
        return _fail("invalid")
    if not isinstance(req, dict) or not isinstance(req.get("action"), str):
        return _fail("invalid")
    action = req["action"]
    device = req.get("device")
    if not isinstance(device, str) or not DEVICE_PATTERN.fullmatch(device):
        return _fail("invalid")
    if mode == "slow":
        time.sleep(SLOW_SECONDS)
    if mode == "busy":
        with _lock:
            n = _busy_seen.get(device, 0)
            if n < BUSY_CALLS:
                _busy_seen[device] = n + 1
                return _fail("busy")
    if action == "list":
        return _list(req, device, mode)
    if action == "heart":
        return _heart(req, device)
    if action == "upload":
        return _upload(req, device, mode)
    if action == "delete":
        return _delete(req, device)
    if action == "link":
        return _link(req, device)
    if action == "unlink":
        if mode == "nounlink":
            return 500, dict(HTML), HTML_PAGE
        return _unlink(device)
    return _fail("invalid")


def _link(req, device):
    # Same answers as handleLink() in apps-script/Code.gs, with "mock:{name}" standing in
    # for a token Google accepted.
    token = req.get("idToken")
    if not isinstance(token, str) or token == "":
        return _fail("invalid")
    name = _clean_name(token[len(MOCK_TOKEN_PREFIX):]) if token.startswith(MOCK_TOKEN_PREFIX) else ""
    if name == "":
        return _fail("signin_failed")
    account = "acct:" + name
    with _lock:
        _devices[device] = {"account": account, "name": name}
        linked = 0
        for p in _uploads:
            if p["owner"] == device and p["account"] == "":
                p["account"] = account
                linked += 1
    return _out(200, JSON, {"ok": True, "account": {"name": name}, "linked": linked})


def _unlink(device):
    with _lock:
        _devices.pop(device, None)
    return _out(200, JSON, {"ok": True})


def _clean_name(s):
    """Same rule as cleanName() in apps-script/Logic.gs."""
    text = re.sub(r"\s+", " ", s if isinstance(s, str) else "")
    text = "".join(c for c in text if unicodedata.category(c) != "Cc")
    text = re.sub(r" {2,}", " ", text).strip()
    return text[:NAME_MAX_LENGTH].strip()


def _upload(req, device, mode):
    # Same checks in the same order as handleUpload() in apps-script/Code.gs.
    if mode == "paused":
        return _fail("paused")
    if mode == "full":
        return _fail("full")
    data = req.get("data")
    if req.get("mime") != "image/jpeg" or not isinstance(data, str) or data == "":
        return _fail("invalid")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        return _fail("invalid")
    if len(raw) > MAX_PHOTO_BYTES:
        return _fail("too_large")
    if not raw.startswith(JPEG_MAGIC):
        return _fail("invalid")
    if mode == "ratelimit":
        return _fail("rate_limited")
    if mode == "slowupload":
        time.sleep(SLOW_UPLOAD_SECONDS)
    with _lock:
        if mode == "flaky":
            n = _flaky_seen.get(device, 0) + 1
            _flaky_seen[device] = n
            if n % 2 == 0:
                return _fail("unavailable")
        _upload_seq[0] += 1
        linked = _devices.get(device)
        # Like uploaderName() in Code.gs: a linked phone shares under the account's name.
        by = linked["name"] if linked and linked["name"] else _clean_name(req.get("name"))
        p = {"id": "u%04d" % _upload_seq[0], "by": by, "at": int(time.time() * 1000), "base": 0,
             "owner": device, "account": linked["account"] if linked else "", "mode": mode, "data": raw}
        _uploads.insert(0, p)
        del _uploads[UPLOADS_KEPT:]
        out = _photo(p, device)
    return _out(200, JSON, {"ok": True, "photo": out})


def _delete(req, device):
    # Same rules as handleDelete() in apps-script/Code.gs: unknown or already gone = ok
    # (safe to repeat); only the phone that uploaded it, or a phone linked to the same
    # account, may delete it. Seed photos belong to no phone.
    pid = req.get("id")
    if not isinstance(pid, str) or pid == "":
        return _fail("invalid")
    with _lock:
        p = next((p for p in _uploads + SEED if p["id"] == pid), None)
        if p is None:
            return _out(200, JSON, {"ok": True})
        if not _mine(p, device):
            return _fail("forbidden")
        _uploads.remove(p)
        _hearts.pop(pid, None)
    return _out(200, JSON, {"ok": True})


def _list(req, device, mode):
    # Same paging as handleList()/pageOf() in apps-script: limit required (>= 1, capped
    # at PAGE_SIZE_MAX); a missing or malformed cursor starts from the beginning.
    try:
        limit = int(req["limit"])
    except (KeyError, TypeError, ValueError):
        return _fail("invalid")
    if limit < 1:
        return _fail("invalid")
    limit = min(limit, PAGE_SIZE_MAX)
    cursor = req.get("cursor")
    offset = int(cursor) if isinstance(cursor, str) and CURSOR_PATTERN.fullmatch(cursor) else 0
    with _lock:
        pool = [] if mode == "empty" else list(SEED)
        pool = [p for p in _uploads if p["mode"] == mode] + pool
        if req.get("mine") is True:
            pool = [p for p in pool if _mine(p, device)]
        page = pool[offset:offset + limit]
        nxt = str(offset + limit) if offset + limit < len(pool) else None
        photos = [_photo(p, device) for p in page]
        linked = _devices.get(device)
    return _out(200, JSON, {
        "ok": True, "photos": photos, "next": nxt, "total": len(pool),
        "uploadsOpen": mode != "paused", "full": mode == "full",
        "account": {"name": linked["name"]} if linked else None,
    })


def _heart(req, device):
    pid = req.get("id")
    on = req.get("on")
    if not isinstance(on, bool) or device == "":
        return _fail("invalid")
    with _lock:
        p = next((p for p in _uploads + SEED if p["id"] == pid), None)
        if p is None:
            return _fail("invalid")
        who = _hearts.setdefault(pid, set())
        who.add(device) if on else who.discard(device)
        out = _photo(p, device)
    return _out(200, JSON, {"ok": True, "hearts": out["hearts"], "hearted": out["hearted"]})


def _render(index, width):
    """A gradient JPEG for seed photo `index`, `width` pixels wide."""
    from PIL import Image
    w0, h0 = SHAPES[index % len(SHAPES)]
    hue = (index * 37) % 256
    a = (hue, 120 + (index * 11) % 100, 255 - hue)
    b = (255 - hue, 90 + (index * 17) % 120, (hue * 2) % 256)
    w, h = width, max(1, round(width * h0 / w0))
    # Vertical gradient: build one column, stretch it across.
    col = Image.new("RGB", (1, h))
    col.putdata([tuple(round(a[c] + (b[c] - a[c]) * y / max(1, h - 1)) for c in range(3))
                 for y in range(h)])
    img = col.resize((w, h))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def _shrink(data, w):
    """An uploaded JPEG at most `w` pixels wide (as Drive's thumbnails would be)."""
    from PIL import Image
    try:
        width = max(1, min(int(w), 2000))
    except (TypeError, ValueError):
        width = DEFAULT_WIDTH
    img = Image.open(io.BytesIO(data))
    if img.width <= width:
        return data
    img = img.convert("RGB").resize((width, max(1, round(img.height * width / img.width))))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def handle_img(photo_id, query):
    """GET /mock-api/img/{id}?w=N -> (status, headers, body bytes)."""
    idx = next((i for i, p in enumerate(SEED) if p["id"] == photo_id), None)
    # Image URLs carry no mode, so the page's own mock= switch (or mode=) is used.
    mode = query.get("mode") or query.get("_page", {}).get("mock")
    with _lock:
        up = next((p for p in _uploads if p["id"] == photo_id), None)
    if up is not None:
        if up["mode"] == "latethumbs" and time.time() * 1000 - up["at"] < LATE_THUMB_SECONDS * 1000:
            return 404, {"Content-Type": "text/plain"}, b"not found"
        return 200, {"Content-Type": "image/jpeg"}, _shrink(up["data"], query.get("w"))
    if idx is None or (mode == "badthumbs" and idx % 3 == 2):
        return 404, {"Content-Type": "text/plain"}, b"not found"
    try:
        width = max(1, min(int(query.get("w", DEFAULT_WIDTH)), 2000))
    except ValueError:
        width = DEFAULT_WIDTH
    key = (photo_id, width)
    with _lock:
        data = _img_cache.get(key)
    if data is None:
        data = _render(idx, width)
        with _lock:
            _img_cache[key] = data
    return 200, {"Content-Type": "image/jpeg"}, data
