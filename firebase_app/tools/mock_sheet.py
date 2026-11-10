"""Stand-in for the Apps Script `sheet` request (apps-script/Code.gs handleSheet).

POST /sheet-api  { "action": "sheet", "tabs": ["Settings", ...] }
  -> { "ok": true, "tabs": { "Settings": [[row 1 cells...], ...], ... } }

The rows come from tests/sheet/{tab}.csv (or tests/sheet/<variant>/{tab}.csv when the
request query has sheet=<variant>, e.g. paused or hidden). Same rules as the real one:
only the allowed tabs are answered, in the allowed order; asking for none of them is
"invalid"; every cell is text, header row first.
"""
import csv
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET_DIR = os.path.join(os.path.dirname(HERE), "tests", "sheet")
ALLOWED = ["Settings", "Program", "Accommodation", "Locations", "Contacts"]   # CONFIG.SITE_TABS
VARIANTS = ("paused", "hidden")
JSON_HEADERS = {"Content-Type": "application/json; charset=utf-8"}


def _reply(obj):
    return 200, dict(JSON_HEADERS), json.dumps(obj).encode("utf-8")


def _rows(path):
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        return [row for row in csv.reader(f)]


def handle_sheet(query, body):
    """POST /sheet-api -> (status, headers, body bytes)."""
    try:
        req = json.loads(body.decode("utf-8"))
    except ValueError:
        req = None
    if not isinstance(req, dict) or req.get("action") != "sheet":
        return _reply({"ok": False, "code": "invalid"})
    wanted = req.get("tabs")
    if wanted is None:
        names = list(ALLOWED)
    elif isinstance(wanted, list):
        names = [n for n in ALLOWED if n in wanted]
    else:
        names = []
    if not names:
        return _reply({"ok": False, "code": "invalid"})
    variant = query.get("sheet")
    folder = os.path.join(SHEET_DIR, variant) if variant in VARIANTS else SHEET_DIR
    tabs = {}
    for name in names:
        path = os.path.join(folder, name + ".csv")
        tabs[name] = _rows(path) if os.path.isfile(path) else None
    if all(v is None for v in tabs.values()):
        return _reply({"ok": False, "code": "unavailable"})
    return _reply({"ok": True, "tabs": tabs})
