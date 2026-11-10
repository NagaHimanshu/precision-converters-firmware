/* Gallery backend: pure logic (Google Apps Script).

   No Google services here (no SpreadsheetApp, DriveApp, ...): every function only works
   on the values it is given, so the site's test page loads this file as a plain script
   and tests it in the browser (tests/logic.test.js). Code.gs does the Google calls.

   The owner pastes this file into the Apps Script editor next to Config.gs and Code.gs.
   All .gs files share one global scope, so names here must not be reused in Code.gs. */

// Device code format, from the site <-> backend contract (32 lower-case hex characters).
const DEVICE_PATTERN = /^[0-9a-f]{32}$/;
// Every JPEG file starts with these bytes.
const JPEG_MAGIC = [0xFF, 0xD8, 0xFF];
// Issuers Google uses in its sign-in tokens.
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
// Settings values that switch something off (the same words as NO in public/app.js).
const OFF_PATTERN = /^(n|no|false|0|off|hide)$/i;
// Actions that come without a phone code: they only read the wedding Sheet.
const DEVICE_FREE_ACTIONS = ["sheet"];
// Minutes Apps Script allows for an every-N-minutes trigger, and the one used otherwise.
const TRIGGER_MINUTES_ALLOWED = [1, 5, 10, 15, 30];
const TRIGGER_MINUTES_FALLBACK = 15;
// Text a spreadsheet would read as the start of a formula.
const FORMULA_START = /^[=+\-@]/;
// cellText()'s guard in front of such text, as a sheet may give it back.
const FORMULA_GUARD = /^'(?=[=+\-@])/;
// Drive error messages that mean "too much at once, try later" (checked first: some of
// them also say "limit" or "quota").
const RATE_ERROR = /rate|too many|per (second|minute|day)|Limit Exceeded: DriveApp/i;
// Drive error messages that mean "no room left".
const FULL_ERROR = /quota|storage/i;
// Drive error messages that mean "no such file" (already deleted for good).
const NOT_FOUND_ERROR = /not found|no item with the given id|could not be found/i;
// The "deleted" value of a photo the Drive sync hid because its file was gone from the
// folder. Unlike TRUE (deleted in the app, or by the owner in the sheet) it is undone by
// the sync when the file is back.
const SYNC_HIDDEN = "sync";
// Random hex characters at the end of a photo's file name.
const PHOTO_NAME_HEX = 6;

// The private data spreadsheet: tab -> columns in order -> kind of value.
// "text" = our own values (ids, hashes); "typed" = text a guest typed (kept from turning
// into a formula); "number"; "bool"; "mark" = false (shown), true (deleted for good) or
// SYNC_HIDDEN (hidden by the Drive sync). Code only ever tests a mark for truthiness,
// except the sync and delete, which tell the two kinds apart.
const SHEET_TABS = {
  Photos: { id: "text", at: "number", by: "typed", deviceHash: "text", accountHash: "text", deleted: "mark" },
  Hearts: { id: "text", deviceHash: "text", at: "number" },
  Devices: { deviceHash: "text", accountHash: "text", name: "typed", linkedAt: "number" },
};

/* ---------- answers ---------- */

function fail(code) {
  return { ok: false, code: code };
}

/* ---------- requests ---------- */

// The request object, or null unless it is a JSON object with a string action and a
// well-formed device code (the actions in DEVICE_FREE_ACTIONS need no device code).
function parseRequest(text) {
  if (typeof text !== "string") return null;
  let req;
  try {
    req = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!req || typeof req !== "object" || Array.isArray(req)) return null;
  if (typeof req.action !== "string") return null;
  if (DEVICE_FREE_ACTIONS.indexOf(req.action) >= 0) return req;
  if (typeof req.device !== "string" || !DEVICE_PATTERN.test(req.device)) return null;
  return req;
}

/* ---------- the wedding Sheet's tabs ---------- */

// The tabs to answer with: the requested names that are on the allowed list, each once, in
// the allowed list's order. No `requested` at all = every allowed tab. null when nothing
// asked for is allowed (or `requested` is not a list), so the request is refused.
function siteTabsWanted(requested, allowed) {
  if (requested === undefined || requested === null) return allowed.slice();
  if (!Array.isArray(requested)) return null;
  const out = allowed.filter((name) => requested.indexOf(name) >= 0);
  return out.length ? out : null;
}

// Sheet values -> rows of text, every cell a string (a blank cell is ""), so the site
// reads them just like the CSV it used to get.
function siteRows(values) {
  return (values || []).map((row) => row.map((x) => (x === null || x === undefined ? "" : String(x))));
}

// A name as typed by a guest, made safe to keep: control characters out, runs of
// whitespace become one space, trimmed, at most `max` characters (code points).
function cleanName(s, max) {
  const text = String(s == null ? "" : s)
    .replace(/\s+/gu, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return Array.from(text).slice(0, max).join("").trim();
}

// Google's tokeninfo answer -> { sub, name } if it is a valid sign-in for our client,
// else null. nowSec = current time in seconds.
function checkTokenInfo(info, clientId, nowSec) {
  if (!info || typeof info !== "object" || !clientId) return null;
  if (info.aud !== clientId) return null;
  if (GOOGLE_ISSUERS.indexOf(info.iss) < 0) return null;
  if (!(Number(info.exp) > nowSec)) return null;
  if (typeof info.sub !== "string" || !info.sub) return null;
  return { sub: info.sub, name: typeof info.name === "string" ? info.name : "" };
}

/* ---------- photos and hearts ---------- */

// Whether a photo row belongs to the viewer: same phone, or same signed-in account.
function canDelete(photoRow, viewer) {
  if (!photoRow || !viewer) return false;
  if (photoRow.deviceHash && photoRow.deviceHash === viewer.deviceHash) return true;
  return !!(photoRow.accountHash && photoRow.accountHash === viewer.accountHash);
}

// Photo rows + heart rows -> Photo objects for the site: deleted ones dropped, newest first.
function buildPhotos(photoRows, heartRows, viewer) {
  const counts = new Map();
  const mineHearted = new Set();
  for (const h of heartRows) {
    counts.set(h.id, (counts.get(h.id) || 0) + 1);
    if (viewer.deviceHash && h.deviceHash === viewer.deviceHash) mineHearted.add(h.id);
  }
  return photoRows
    .filter((r) => !r.deleted)
    .sort((a, b) => b.at - a.at)
    .map((r) => ({
      id: r.id,
      by: r.by || "",
      at: r.at,
      hearts: counts.get(r.id) || 0,
      hearted: mineHearted.has(r.id),
      mine: canDelete(r, viewer),
    }));
}

// One page of `photos`. cursor = decimal offset as a string (anything else = start);
// limit is capped at maxLimit. next = cursor of the following page, or null.
function pageOf(photos, cursor, limit, maxLimit) {
  let offset = typeof cursor === "string" && /^\d+$/.test(cursor) ? parseInt(cursor, 10) : 0;
  if (!Number.isSafeInteger(offset)) offset = 0;
  const n = Math.max(1, Math.min(Math.floor(Number(limit)) || 1, maxLimit));
  const end = offset + n;
  return { photos: photos.slice(offset, end), next: end < photos.length ? String(end) : null };
}

// What a heart tap changes: add a row, or remove the row at removeIndex.
function applyHeart(heartRows, id, deviceHash, on) {
  const i = heartRows.findIndex((h) => h.id === id && h.deviceHash === deviceHash);
  if (on) return { add: i < 0, removeIndex: -1 };
  return { add: false, removeIndex: i };
}

// Uploads from one phone since sinceMs (deleted ones count too).
function countRecent(photoRows, deviceHash, sinceMs) {
  let n = 0;
  for (const r of photoRows) if (r.deviceHash === deviceHash && r.at >= sinceMs) n++;
  return n;
}

function isJpeg(bytes) {
  if (!bytes || bytes.length < JPEG_MAGIC.length) return false;
  return JPEG_MAGIC.every((b, i) => (bytes[i] & 0xFF) === b);
}

// A Drive error message -> the answer for the site: "busy" (too many calls; try again,
// nothing remembered), "full" (no room left) or "" (anything else).
function driveErrorCode(message) {
  const text = String(message == null ? "" : message);
  if (RATE_ERROR.test(text)) return "busy";
  if (FULL_ERROR.test(text)) return "full";
  return "";
}

// Whether a Drive error message means the file is not there (any more).
function driveNotFound(message) {
  return NOT_FOUND_ERROR.test(String(message == null ? "" : message));
}

// What the Drive sync changes, given the ids of the folder's live files (a Set):
// hide = shown rows whose file is gone (only rows older than beforeMs: a newer row's
// file may have been made after the folder was listed); show = rows the sync hid
// earlier whose file is back. Rows deleted for good (true) are never touched.
function syncChanges(photoRows, liveIds, beforeMs) {
  const hide = [];
  const show = [];
  for (const r of photoRows) {
    if (!r.id) continue;
    if (!r.deleted && r.at < beforeMs && !liveIds.has(r.id)) hide.push(r);
    else if (r.deleted === SYNC_HIDDEN && liveIds.has(r.id)) show.push(r);
  }
  return { hide: hide, show: show };
}

// "{stamp}-{6 hex from uuid}.jpg": sorts by time in Drive, and two photos sent in the
// same second still get different names.
function photoFileName(stamp, uuid) {
  const hex = String(uuid).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, PHOTO_NAME_HEX);
  return stamp + "-" + hex + ".jpg";
}

/* ---------- storage and settings ---------- */

// Drive storage: "ok", "warn" (email the owner) or "stop" (album full). limit <= 0 = no limit.
function storageState(used, limit, warnPct, stopPct) {
  if (!(limit > 0)) return "ok";
  const pct = (used / limit) * 100;
  if (pct >= stopPct) return "stop";
  if (pct >= warnPct) return "warn";
  return "ok";
}

// Settings rows [[key, value], ...] -> whether uploads are open. Missing or blank = open.
function uploadsOpenFrom(settingsRows, key) {
  const want = String(key).trim().toLowerCase();
  for (const row of settingsRows || []) {
    if (String(row[0] == null ? "" : row[0]).trim().toLowerCase() !== want) continue;
    return !OFF_PATTERN.test(String(row[1] == null ? "" : row[1]).trim());
  }
  return true;
}

// A text with {name} placeholders filled from `values`; unknown placeholders stay.
function fillText(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) =>
    (Object.prototype.hasOwnProperty.call(values, k) ? String(values[k]) : m));
}

// A Drive folder ID from what the owner typed: a bare ID, or a folder link
// (.../folders/<ID>?usp=sharing, .../u/0/folders/<ID>, .../open?id=<ID>). "" = blank or not recognised.
function folderIdFrom(value) {
  const text = String(value == null ? "" : value).trim();
  if (/^[A-Za-z0-9_-]+$/.test(text)) return text;
  const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(text) || /[?&]id=([A-Za-z0-9_-]+)/.exec(text);
  return m ? m[1] : "";
}

// SYNC_MINUTES -> a value Apps Script accepts; valid = false when the fallback was used.
function triggerMinutes(n) {
  const valid = typeof n === "number" && TRIGGER_MINUTES_ALLOWED.indexOf(n) >= 0;
  return { minutes: valid ? n : TRIGGER_MINUTES_FALLBACK, valid: valid };
}

/* ---------- spreadsheet rows ---------- */

// Text a guest typed, made unable to become a formula when written to a sheet.
function cellText(s) {
  s = String(s == null ? "" : s);
  return FORMULA_START.test(s) ? "'" + s : s;
}

// Sheet values (header row first) -> row objects for one tab's columns, each with
// `row` = its sheet row number. Blank rows are skipped. Typed text loses cellText()'s
// guard, whether or not the sheet kept it, so guests never see it.
function rowObjects(values, columns) {
  const names = Object.keys(columns);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (!v.some((x) => x !== "" && x != null)) continue;
    const o = {};
    names.forEach((name, c) => {
      const x = v[c];
      const kind = columns[name];
      if (kind === "number") o[name] = Number(x) || 0;
      else if (kind === "bool") o[name] = x === true || /^true$/i.test(String(x).trim());
      else if (kind === "mark") o[name] = markOf(x);
      else if (kind === "typed") o[name] = x == null ? "" : String(x).replace(FORMULA_GUARD, "");
      else o[name] = x == null ? "" : String(x);
    });
    o.row = i + 1;
    out.push(o);
  }
  return out;
}

// A "mark" cell -> false, true or SYNC_HIDDEN.
function markOf(x) {
  if (x === true || /^true$/i.test(String(x).trim())) return true;
  return String(x).trim().toLowerCase() === SYNC_HIDDEN ? SYNC_HIDDEN : false;
}

// A row object -> the values to write, in column order.
function rowValues(obj, columns) {
  return Object.keys(columns).map((name) => {
    const x = obj[name];
    const kind = columns[name];
    if (kind === "number") return Number(x) || 0;
    if (kind === "bool") return x === true;
    if (kind === "mark") return x === SYNC_HIDDEN ? SYNC_HIDDEN : x === true;
    if (kind === "typed") return cellText(x);
    return x == null ? "" : String(x);
  });
}

/* ---------- cache ---------- */

// JSON with every non-ASCII character escaped, so its length is also its size in bytes.
function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    (c) => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));
}

// Cut `text` into cache values of at most `size` characters. Every part carries `stamp`
// so parts from two different writes are never joined.
function toCacheParts(text, size, stamp) {
  const prefix = stamp + ":";
  const room = Math.max(1, size - prefix.length);
  const parts = [];
  for (let i = 0; i < text.length || i === 0; i += room) parts.push(prefix + text.slice(i, i + room));
  return { head: prefix + parts.length, parts: parts };
}

const CACHE_HEAD = /^(.*):(\d+)$/;

// The stamp of a list remembered while its tab is in generation `gen` (see readRows in
// Code.gs): a list is only used while its tab is still in the generation it was read in.
function genStamp(gen, id) {
  return String(gen) + "." + String(id);
}

// Whether a cache head was written in generation `gen`.
function headInGen(head, gen) {
  return typeof head === "string" && typeof gen === "string" && gen !== "" && head.indexOf(gen + ".") === 0;
}

// How many parts a cache head says there are (0 = not a head).
function cachePartCount(head) {
  const m = CACHE_HEAD.exec(typeof head === "string" ? head : "");
  return m ? Number(m[2]) : 0;
}

// The text back from its head and parts, or null if anything is missing or mixed.
function fromCacheParts(head, parts) {
  const m = CACHE_HEAD.exec(typeof head === "string" ? head : "");
  if (!m || !parts || parts.length !== Number(m[2])) return null;
  const prefix = m[1] + ":";
  let text = "";
  for (const p of parts) {
    if (typeof p !== "string" || p.indexOf(prefix) !== 0) return null;
    text += p.slice(prefix.length);
  }
  return text;
}
