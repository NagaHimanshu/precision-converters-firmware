/* Gallery backend: the web app (Google Apps Script).

   What is here: doPost (every request from the site), doGet (a health check), the
   request handlers, small adapters around Google's services (Sheets, Drive, cache, lock, mail,
   script properties), and setup(), which the owner runs once from the editor.
   The rules themselves live in Logic.gs (no Google services, tested in the browser);
   the settings live in Config.gs (private).

   The owner pastes Config.gs, Logic.gs, Code.gs and appsscript.json into the Apps Script
   editor of the wedding account and deploys it as a web app (execute as me, anyone).

   Every request answers JSON: { ok: true, ... } or { ok: false, code }, never an error
   page. Reads need no lock; every write runs under the script lock.

   All .gs files share one global scope and Apps Script may load them in any order:
   nothing at the top level here may use Logic.gs or Config.gs names or call a Google
   service. */

// Script Properties (set by setup()).
const PROP_SECRET = "HASH_SECRET";       // the salt for hash(); never logged, never in code
const PROP_FOLDER = "FOLDER_ID";         // photos folder made by setup()
const PROP_DATA_SHEET = "DATA_SHEET_ID"; // private data spreadsheet made by setup()
const PROP_LAST_WARN = "lastWarnDate";   // day the "storage nearly full" email was last sent
// Cache keys.
const ROWS_KEY = "rows:";                // + tab: "rows:{tab}:n" (head), "rows:{tab}:{i}" (parts)
const GEN_KEY = "gen:";                  // + tab: changes on every write to that tab (see readRows)
const WARM_TABS = ["Photos", "Hearts", "Devices"];   // the lists every request reads
const UPLOADS_OPEN_KEY = "settings:uploadsOpen";
const STORAGE_KEY = "storage:numbers";   // JSON { used, limit } in bytes
// What Drive's "storage full" error is remembered as: 100% used.
const DRIVE_FULL = { used: 1, limit: 1 };
// The only kind of photo accepted (from the site <-> backend contract).
const JPEG_MIME = "image/jpeg";
const MS_PER_HOUR = 3600000;
const MS_PER_SECOND = 1000;
// Apps Script stops any run (a request or the trigger) after 6 minutes.
const MAX_RUN_MS = 360000;
// Drive search for the files in a folder that are not in the trash.
const LIVE_FILES_QUERY = "trashed = false";
const BYTES_PER_GB = 1073741824;
// Utilities.formatDate patterns: photo file names, and the day for "once a day".
const FILE_STAMP_FORMAT = "yyyyMMdd-HHmmss";
const DAY_FORMAT = "yyyy-MM-dd";
// Longest time Apps Script's cache keeps anything, in seconds.
const CACHE_MAX_SECONDS = 21600;
// Every hash starts with a letter, so a sheet cell never begins with "-" (read as a formula).
const HASH_PREFIX = "h";
// The function the time trigger runs.
const SYNC_FUNCTION = "syncDeletions";
// Google account IDs are hashed as "g:" + ID (never kept as they are).
const ACCOUNT_PREFIX = "g:";
const HTTP_OK = 200;

// Things looked up once per request (Apps Script starts fresh for every request).
const EXEC = { props: null, spreadsheet: null, dirty: {} };

/* ---------- web app entry points ---------- */

function doGet() {
  return reply({ ok: true, service: "gallery" });
}

function doPost(e) {
  try {
    return reply(route(e && e.postData ? e.postData.contents : null));
  } catch (err) {
    console.error("Gallery request failed:", err && err.stack ? err.stack : String(err));
    return reply(fail("unavailable"));
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route(body) {
  const req = parseRequest(body);
  if (!req) return fail("invalid");
  const handler = handlerFor(req.action);
  if (!handler) return fail("invalid");
  const missing = missingSetup();
  if (missing) {
    console.error("Gallery is not set up (" + missing + " missing): run setup() once in the Apps Script editor.");
    return fail("unavailable");
  }
  return handler(req, viewerOf(hash(req.device)));
}

function handlerFor(action) {
  const handlers = {
    list: handleList,
    heart: handleHeart,
    upload: handleUpload,
    delete: handleDelete,
    link: handleLink,
    unlink: handleUnlink,
  };
  return Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
}

/* ---------- handlers ---------- */

// { cursor?, limit, mine? } -> one page of photos, newest first, plus the album's state.
function handleList(req, viewer) {
  const limit = Number(req.limit);
  if (!(limit >= 1)) return fail("invalid");
  let photos = buildPhotos(readRows("Photos"), readRows("Hearts"), viewer);
  if (req.mine === true) photos = photos.filter((p) => p.mine);
  const page = pageOf(photos, req.cursor, limit, CONFIG.PAGE_SIZE_MAX);
  return {
    ok: true,
    photos: page.photos,
    next: page.next,
    total: photos.length,
    uploadsOpen: uploadsOpen(),
    full: albumFull(),
    account: viewer.accountHash ? { name: viewer.name || "" } : null,
  };
}

// { id, on } -> this phone's heart on that photo is on / off. Safe to repeat.
function handleHeart(req, viewer) {
  if (typeof req.id !== "string" || !req.id || typeof req.on !== "boolean") return fail("invalid");
  if (!readRows("Photos").some((r) => r.id === req.id && !r.deleted)) return fail("invalid");
  return withLock(() => {
    const hearts = readRows("Hearts", true);
    const change = applyHeart(hearts, req.id, viewer.deviceHash, req.on);
    let count = hearts.filter((h) => h.id === req.id).length;
    if (change.add) {
      addRow("Hearts", { id: req.id, deviceHash: viewer.deviceHash, at: Date.now() });
      count++;
    }
    if (change.removeIndex >= 0) {
      removeRow("Hearts", hearts[change.removeIndex].row);
      count--;
    }
    return { ok: true, hearts: count, hearted: req.on };
  });
}

// { name, mime, data (base64 JPEG) } -> the new photo. Cheap checks first. The file is
// made outside the lock (a Drive write takes seconds; hearts must not wait for it); only
// its row is added under the lock.
function handleUpload(req, viewer) {
  if (!uploadsOpen()) return fail("paused");
  const storage = storageNow();
  const level = storageLevel(storage);
  if (level === "stop") {
    maybeWarnOwner(storage);
    return fail("full");
  }
  if (level === "warn") maybeWarnOwner(storage);

  if (req.mime !== JPEG_MIME || typeof req.data !== "string" || !req.data) return fail("invalid");
  let bytes;
  try {
    bytes = Utilities.base64Decode(req.data);
  } catch (err) {
    return fail("invalid");
  }
  if (bytes.length > CONFIG.MAX_PHOTO_BYTES) return fail("too_large");
  if (!isJpeg(bytes)) return fail("invalid");

  const now = Date.now();
  if (countRecent(readRows("Photos"), viewer.deviceHash, now - MS_PER_HOUR) >= CONFIG.RATE_LIMIT_PER_HOUR) {
    return fail("rate_limited");
  }

  const folder = photosFolder();
  const fileName = photoFileName(Utilities.formatDate(new Date(now), timeZone(), FILE_STAMP_FORMAT), Utilities.getUuid());
  const blob = Utilities.newBlob(bytes, JPEG_MIME, fileName);
  const row = {
    id: "", at: now, by: uploaderName(req, viewer),
    deviceHash: viewer.deviceHash, accountHash: viewer.accountHash || "", deleted: false,
  };
  let file;
  try {
    file = folder.createFile(blob);
  } catch (err) {
    const code = driveErrorCode(err && err.message);
    if (!code) throw err;
    console.warn("Gallery: Drive refused the photo (" + code + "):", String(err));
    if (code === "full") {
      // Remembered for a while, so lists show the album full and other uploads stop early.
      cachePut(STORAGE_KEY, JSON.stringify(DRIVE_FULL), CONFIG.STORAGE_CACHE_SECONDS);
      maybeWarnOwner(storage && storage.limit > 0 ? { used: storage.limit, limit: storage.limit } : null);
    }
    return fail(code);
  }
  row.id = file.getId();
  let saved = false;
  try {
    return withLock(() => {
      addRow("Photos", row);
      saved = true;
      return { ok: true, photo: buildPhotos([row], [], viewer)[0] };
    });
  } finally {
    // No row (lock busy, or the write failed) = never shown: move the file to the trash.
    // (Trashed files still count against Drive storage until the trash is emptied.)
    if (!saved) {
      try {
        file.setTrashed(true);
      } catch (e) {
        console.warn("Gallery: could not trash " + row.id + ":", String(e));
      }
    }
  }
}

// { id } -> the photo is in the Drive trash (the owner can still get it back for 30 days)
// and gone from everyone's gallery. Safe to repeat: an unknown or already deleted photo
// is done. Only the phone that added it, or a phone linked to the same Google account,
// may delete it. The Drive call runs outside the lock; only the row is changed under it.
function handleDelete(req, viewer) {
  if (typeof req.id !== "string" || !req.id) return fail("invalid");
  const row = photoRowOf(req.id);
  // Hidden by the sync is not enough: deleting makes it permanent (the file may come back).
  if (!row || row.deleted === true) return { ok: true };
  if (!canDelete(row, viewer)) return fail("forbidden");
  try {
    DriveApp.getFileById(req.id).setTrashed(true);
  } catch (err) {
    const message = err && err.message;
    if (!driveNotFound(message)) {
      console.warn("Gallery: could not trash " + req.id + ":", String(err));
      return fail(driveErrorCode(message) === "busy" ? "busy" : "unavailable");
    }
    // Already deleted for good in Drive: only the row is left to mark.
  }
  return withLock(() => {
    const fresh = readRows("Photos", true).find((r) => r.id === req.id);
    if (fresh && fresh.deleted !== true) setDeleted(fresh.row, true);
    return { ok: true };
  });
}

// { idToken } -> this phone is linked to the Google account the token is for: from now on
// every request from it acts as that account (Photos by me, delete, the name on uploads),
// and its photos not yet on an account join it. The token is checked with Google first,
// outside the lock; nothing from it is trusted unless checkTokenInfo() accepts it. Only a
// hash of the account ID and the cleaned display name are kept (never the email, the
// raw ID or the token; the token is never logged). Blank GOOGLE_CLIENT_ID = sign-in off.
// linked = how many of this phone's photos still in the gallery joined the account.
function handleLink(req, viewer) {
  if (typeof req.idToken !== "string" || !req.idToken) return fail("invalid");
  if (!CONFIG.GOOGLE_CLIENT_ID) {
    console.warn("Gallery sign-in refused: CONFIG.GOOGLE_CLIENT_ID is blank.");
    return fail("signin_failed");
  }
  const who = checkTokenInfo(googleTokenInfo(req.idToken), CONFIG.GOOGLE_CLIENT_ID, Math.floor(Date.now() / MS_PER_SECOND));
  if (!who) return fail("signin_failed");
  const account = { accountHash: hash(ACCOUNT_PREFIX + who.sub), name: cleanName(who.name, CONFIG.NAME_MAX_LENGTH) };
  return withLock(() => {
    const device = readRows("Devices", true).find((d) => d.deviceHash === viewer.deviceHash);
    if (device) {
      setCell("Devices", device.row, "accountHash", account.accountHash);
      setCell("Devices", device.row, "name", cellText(account.name));
      setCell("Devices", device.row, "linkedAt", Date.now());
    } else {
      addRow("Devices", { deviceHash: viewer.deviceHash, accountHash: account.accountHash, name: account.name, linkedAt: Date.now() });
    }
    let linked = 0;
    readRows("Photos", true).forEach((r) => {
      if (r.deviceHash !== viewer.deviceHash || r.accountHash) return;
      setCell("Photos", r.row, "accountHash", account.accountHash);
      if (!r.deleted) linked++;
    });
    return { ok: true, account: { name: account.name }, linked: linked };
  });
}

// {} -> this phone is no longer linked to a Google account. Its photos keep their
// account, so they stay "mine" on the account's other phones. Safe to repeat.
function handleUnlink(req, viewer) {
  return withLock(() => {
    const device = readRows("Devices", true).find((d) => d.deviceHash === viewer.deviceHash);
    if (device && (device.accountHash || device.name)) {
      setCell("Devices", device.row, "accountHash", "");
      setCell("Devices", device.row, "name", "");
    }
    return { ok: true };
  });
}

// Google's answer about a sign-in token (an object), or null when Google can't be asked
// or doesn't accept it. Nothing logged here may contain the token.
function googleTokenInfo(token) {
  let res;
  try {
    // In a POST body, not the address: addresses can end up in logs.
    res = UrlFetchApp.fetch(CONFIG.TOKENINFO_URL, { method: "post", payload: { id_token: token }, muteHttpExceptions: true });
  } catch (err) {
    console.warn("Gallery sign-in: could not ask Google about the token (" + (err && err.name ? err.name : "error") + ").");
    return null;
  }
  const status = res.getResponseCode();
  if (status !== HTTP_OK) {
    console.warn("Gallery sign-in: Google did not accept the token (HTTP " + status + ").");
    return null;
  }
  try {
    const info = JSON.parse(res.getContentText());
    return info && typeof info === "object" && !Array.isArray(info) ? info : null;
  } catch (err) {
    console.warn("Gallery sign-in: Google's answer was not JSON.");
    return null;
  }
}

// A photo's row, or null. The cache may not have a photo added a moment ago: then the sheet.
function photoRowOf(id) {
  const find = (rows) => rows.find((r) => r.id === id) || null;
  return find(readRows("Photos")) || find(readRows("Photos", true));
}

// The name shown on a photo: the linked Google account's, else what the guest typed.
function uploaderName(req, viewer) {
  const typed = typeof req.name === "string" ? req.name : "";
  return cleanName(viewer.accountHash && viewer.name ? viewer.name : typed, CONFIG.NAME_MAX_LENGTH);
}

function photosFolder() {
  const id = folderIdFrom(CONFIG.DRIVE_FOLDER_ID) || prop(PROP_FOLDER);
  if (!id) throw new Error("FOLDER_ID missing: run setup() once in the Apps Script editor");
  return DriveApp.getFolderById(id);
}

function timeZone() {
  return CONFIG.TIME_ZONE || Session.getScriptTimeZone();
}

/* ---------- who is asking ---------- */

// HMAC of a value with the secret salt: the same phone always gets the same hash, and
// nobody can work back from the hash to the phone's code.
function hash(value) {
  const secret = prop(PROP_SECRET);
  if (!secret) throw new Error("HASH_SECRET missing: run setup() once in the Apps Script editor");
  const bytes = Utilities.computeHmacSha256Signature(String(value), secret);
  return HASH_PREFIX + Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

// The phone, and the Google account it is linked to (if any).
function viewerOf(deviceHash) {
  const d = readRows("Devices").find((r) => r.deviceHash === deviceHash);
  const accountHash = d && d.accountHash ? d.accountHash : null;
  return { deviceHash: deviceHash, accountHash: accountHash, name: accountHash ? d.name : null };
}

/* ---------- album state ---------- */

// The pause switch in the wedding Sheet. Any problem reading it = open (a settings glitch
// must never block guests; the switch is only for pausing on purpose).
function uploadsOpen() {
  const hit = cacheGet(UPLOADS_OPEN_KEY);
  if (hit === "open" || hit === "paused") return hit === "open";
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.WEDDING_SHEET_ID).getSheetByName(CONFIG.SETTINGS_TAB);
    if (!sheet) throw new Error("tab " + CONFIG.SETTINGS_TAB + " not found");
    const open = uploadsOpenFrom(sheet.getDataRange().getValues(), CONFIG.UPLOADS_KEY);
    cachePut(UPLOADS_OPEN_KEY, open ? "open" : "paused", CONFIG.SETTINGS_CACHE_SECONDS);
    return open;
  } catch (err) {
    // Remembered too, so a broken WEDDING_SHEET_ID is not opened on every request.
    console.warn("Gallery settings unreadable; uploads stay open:", String(err));
    cachePut(UPLOADS_OPEN_KEY, "open", CONFIG.SETTINGS_CACHE_SECONDS);
    return true;
  }
}

// Drive storage { used, limit } in bytes, remembered for STORAGE_CACHE_SECONDS; null if
// Drive can't say (then nothing is stopped: a real "full" error from Drive still is).
function storageNow() {
  const hit = cacheGet(STORAGE_KEY);
  if (hit) {
    try {
      const s = JSON.parse(hit);
      if (s && typeof s.used === "number" && typeof s.limit === "number") return s;
    } catch (err) {
      // not ours: ask Drive below
    }
  }
  try {
    const s = { used: DriveApp.getStorageUsed(), limit: DriveApp.getStorageLimit() };
    cachePut(STORAGE_KEY, JSON.stringify(s), CONFIG.STORAGE_CACHE_SECONDS);
    return s;
  } catch (err) {
    console.warn("Gallery storage check failed:", String(err));
    return null;
  }
}

// "ok", "warn" or "stop" for storageNow()'s answer.
function storageLevel(s) {
  return s ? storageState(s.used, s.limit, CONFIG.STORAGE_WARN_PERCENT, CONFIG.STORAGE_STOP_PERCENT) : "ok";
}

// Drive storage at the stop level.
function albumFull() {
  return storageLevel(storageNow()) === "stop";
}

// Emails the owner that storage is (nearly) full, at most once a calendar day (TIME_ZONE).
// s = storageNow()'s { used, limit }, or null = Drive said full but no sizes are known.
// Never fails the upload: any problem is only logged. A failed email is not retried that day.
function maybeWarnOwner(s) {
  try {
    const today = Utilities.formatDate(new Date(), timeZone(), DAY_FORMAT);
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROP_LAST_WARN) === today) return;
    // Claim the day under the lock, so two uploads at once send one email. Lock taken =
    // skip; a later upload sends it.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) return;
    try {
      if (props.getProperty(PROP_LAST_WARN) === today) return;
      props.setProperty(PROP_LAST_WARN, today);
    } finally {
      lock.releaseLock();
    }
    const known = !!(s && s.limit > 0);
    const values = {
      percent: known ? Math.floor((s.used / s.limit) * 100) : 100,
      used: known ? (s.used / BYTES_PER_GB).toFixed(1) : "?",
      limit: known ? (s.limit / BYTES_PER_GB).toFixed(1) : "?",
      stop: CONFIG.STORAGE_STOP_PERCENT,
    };
    MailApp.sendEmail(CONFIG.OWNER_EMAIL, fillText(CONFIG.WARN_MAIL_SUBJECT, values), fillText(CONFIG.WARN_MAIL_BODY, values));
  } catch (err) {
    console.warn("Gallery storage warning email not sent:", String(err));
  }
}

/* ---------- setup state ---------- */

function prop(name) {
  if (!EXEC.props) EXEC.props = PropertiesService.getScriptProperties().getProperties();
  return EXEC.props[name] || "";
}

function dataSheetId() {
  return CONFIG.DATA_SHEET_ID || prop(PROP_DATA_SHEET);
}

// Name of the first thing setup() should have made but didn't, or "".
function missingSetup() {
  if (!prop(PROP_SECRET)) return PROP_SECRET;
  if (!dataSheetId()) return PROP_DATA_SHEET;
  return "";
}

/* ---------- data spreadsheet ---------- */

function dataTab(name) {
  if (!EXEC.spreadsheet) EXEC.spreadsheet = SpreadsheetApp.openById(dataSheetId());
  const sheet = EXEC.spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("Tab " + name + " missing in the gallery data spreadsheet: run setup() again");
  return sheet;
}

// All rows of a tab as objects (see SHEET_TABS), from the cache when it has them.
// fresh = read the sheet itself (under the lock, before a change).
// Each tab has a generation in the cache that every write changes (after flushing it).
// The generation is looked up before the sheet is read and the rows are remembered under
// it, and remembered rows are only used while it is still the tab's generation. So a read
// that overlaps a write never brings the old rows back, however long they are kept.
function readRows(name, fresh) {
  const gen = rowsGen(name);
  if (!fresh) {
    const hit = cacheGetJson(ROWS_KEY + name, gen);
    if (hit) return hit;
  }
  const rows = rowObjects(dataTab(name).getDataRange().getValues(), SHEET_TABS[name]);
  cachePutJson(ROWS_KEY + name, rows, CONFIG.LIST_CACHE_SECONDS, gen);
  return rows;
}

// The tab's current generation (a new one if the cache has none).
function rowsGen(name) {
  const hit = cacheGet(GEN_KEY + name);
  if (hit) return hit;
  const gen = Utilities.getUuid();
  cachePut(GEN_KEY + name, gen, CACHE_MAX_SECONDS);
  return gen;
}

// Writes: only inside withLock(), which clears the cache of changed tabs afterwards.
function addRow(name, obj) {
  dataTab(name).appendRow(rowValues(obj, SHEET_TABS[name]));
  EXEC.dirty[name] = true;
}

function removeRow(name, rowNumber) {
  dataTab(name).deleteRow(rowNumber);
  EXEC.dirty[name] = true;
}

function setCell(name, rowNumber, column, value) {
  const col = Object.keys(SHEET_TABS[name]).indexOf(column) + 1;
  if (col < 1) throw new Error("No column " + column + " in tab " + name);
  dataTab(name).getRange(rowNumber, col).setValue(value);
  EXEC.dirty[name] = true;
}

// Photo rows are only ever marked, never removed: true = deleted for good (the owner can
// undo it in the sheet), SYNC_HIDDEN = hidden by the Drive sync, false = shown.
function setDeleted(rowNumber, mark) {
  setCell("Photos", rowNumber, "deleted", mark);
}

function invalidate(name) {
  cachePut(GEN_KEY + name, Utilities.getUuid(), CACHE_MAX_SECONDS);   // rows read before this write: never used
  cacheRemove(ROWS_KEY + name + ":n");   // without its head, the parts are never used
}

// Runs fn under the script lock; "busy" if another change holds it for too long.
// Changes are flushed and the cache cleared before the lock is released, so the next
// request sees them.
function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) return fail("busy");
  try {
    return fn();
  } finally {
    try {
      SpreadsheetApp.flush();
    } finally {
      Object.keys(EXEC.dirty).forEach(invalidate);
      EXEC.dirty = {};
      lock.releaseLock();
    }
  }
}

/* ---------- cache (best effort: any cache problem just means reading the sheet) ---------- */

function cacheTtl(seconds) {
  return Math.min(Math.floor(Number(seconds) || 0), CACHE_MAX_SECONDS);
}

function cacheGet(key) {
  try {
    return CacheService.getScriptCache().get(key);
  } catch (err) {
    console.warn("Gallery cache read failed:", String(err));
    return null;
  }
}

function cachePut(key, value, seconds) {
  const ttl = cacheTtl(seconds);
  if (ttl < 1) return;
  try {
    CacheService.getScriptCache().put(key, value, ttl);
  } catch (err) {
    console.warn("Gallery cache write failed:", String(err));
  }
}

function cacheRemove(key) {
  try {
    CacheService.getScriptCache().remove(key);
  } catch (err) {
    console.warn("Gallery cache remove failed:", String(err));
  }
}

// A value too big for one cache entry, stored as parts of at most CACHE_CHUNK_BYTES,
// stamped with generation `gen` (see readRows).
function cachePutJson(key, value, seconds, gen) {
  const ttl = cacheTtl(seconds);
  if (ttl < 1) return;
  try {
    const cut = toCacheParts(asciiJson(value), CONFIG.CACHE_CHUNK_BYTES, genStamp(gen, Utilities.getUuid()));
    const parts = {};
    cut.parts.forEach((p, i) => { parts[key + ":" + i] = p; });
    const cache = CacheService.getScriptCache();
    cache.putAll(parts, ttl);
    cache.put(key + ":n", cut.head, ttl);   // head last: it is only there when all parts are
  } catch (err) {
    console.warn("Gallery cache write failed:", String(err));
  }
}

// The value, or null when missing, broken, or written in another generation than `gen`.
function cacheGetJson(key, gen) {
  try {
    const cache = CacheService.getScriptCache();
    const head = cache.get(key + ":n");
    if (!headInGen(head, gen)) return null;
    const n = cachePartCount(head);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + ":" + i);
    const got = cache.getAll(keys);
    const text = fromCacheParts(head, keys.map((k) => got[k]));
    return text === null ? null : JSON.parse(text);
  } catch (err) {
    console.warn("Gallery cache read failed:", String(err));
    return null;
  }
}

/* ---------- time trigger ---------- */

// Run by the time trigger every SYNC_MINUTES: the Drive sync (syncNow), then the lists
// guests' requests read are read again and remembered (warmCache), so those requests
// rarely have to wait for the spreadsheet. Never throws.
function syncDeletions() {
  syncNow();
  warmCache();
}

// The photo, heart and device lists read fresh and remembered for LIST_CACHE_SECONDS, and
// the pause switch and Drive storage looked up if they aren't remembered. Problems are
// only logged: guests' requests then just read the sheet themselves.
function warmCache() {
  try {
    if (missingSetup()) return;
    WARM_TABS.forEach((name) => {
      try {
        readRows(name, true);
      } catch (err) {
        console.warn("Gallery cache warm-up skipped " + name + ":", String(err));
      }
    });
    uploadsOpen();
    storageNow();
  } catch (err) {
    console.warn("Gallery cache warm-up failed:", String(err));
  }
}

// Photos deleted or trashed directly in Drive
// leave the gallery (their rows are marked SYNC_HIDDEN), and come back if their file is
// back (restored from the trash). This also tidies a photo whose file was trashed but
// whose row could not be written. Emptying the whole folder (clearing test photos before
// launch) hides every photo. Drive is listed outside the lock; a listing that fails or
// takes longer than SYNC_MAX_SECONDS is never used, and anything the sync hides it undoes
// on a later run once the files are listed again. Photos deleted in the app (or set TRUE
// in the sheet) stay deleted. Never throws: problems are only logged (Executions in the editor).
function syncNow() {
  try {
    const missing = missingSetup();
    if (missing) {
      console.warn("Gallery sync skipped: " + missing + " missing; run setup() once in the Apps Script editor.");
      return;
    }
    const started = Date.now();
    const live = liveFileIds(started);
    if (!live) return;
    // A row younger than the longest run may belong to an upload whose file was made
    // after the folder was listed: left for the next run.
    const before = started - MAX_RUN_MS;
    const seen = syncChanges(readRows("Photos"), live, before);
    if (!seen.hide.length && !seen.show.length) return;
    const r = withLock(() => {
      const c = syncChanges(readRows("Photos", true), live, before);
      c.hide.forEach((row) => setDeleted(row.row, SYNC_HIDDEN));
      c.show.forEach((row) => setDeleted(row.row, false));
      return { ok: true, hidden: c.hide.length, shown: c.show.length };
    });
    if (!r.ok) {
      console.warn("Gallery sync: another change held the lock; the next run tries again.");
      return;
    }
    console.log("Gallery sync: " + r.hidden + " photo(s) gone from Drive hidden, " + r.shown + " back in Drive shown again.");
  } catch (err) {
    console.error("Gallery sync failed:", err && err.stack ? err.stack : String(err));
  }
}

// Ids of the photos folder's files that are not in the trash, or null when listing took
// longer than SYNC_MAX_SECONDS (part of the list would make the rest look deleted).
function liveFileIds(started) {
  const limitMs = CONFIG.SYNC_MAX_SECONDS * MS_PER_SECOND;
  const ids = new Set();
  const it = photosFolder().searchFiles(LIVE_FILES_QUERY);
  while (it.hasNext()) {
    ids.add(it.next().getId());
    if (Date.now() - started >= limitMs) {
      console.warn("Gallery sync: listing the photos folder took longer than CONFIG.SYNC_MAX_SECONDS (" +
        CONFIG.SYNC_MAX_SECONDS + "); nothing changed, the next run tries again.");
      return null;
    }
  }
  return ids;
}

/* ---------- setup (run once by the owner; safe to run again) ---------- */

// Makes (or finds again) the photos folder, the private data spreadsheet, the hash
// secret and the time trigger, then logs the links. Run from the editor: select
// "setup" and press Run. Nothing already there is replaced or emptied.
function setup() {
  const props = PropertiesService.getScriptProperties();
  const folder = setupFolder(props);
  const ss = setupDataSheet(props);
  if (props.getProperty(PROP_SECRET)) {
    Logger.log("Hash secret: already set, kept.");
  } else {
    props.setProperty(PROP_SECRET, newSecret());
    Logger.log("Hash secret: created and kept in Script Properties (do not share or change it).");
  }
  const minutes = setupTrigger();
  EXEC.props = null;
  Logger.log("Photos folder: " + folder.getUrl() + " (id " + folder.getId() + ")");
  Logger.log("Private data spreadsheet: " + ss.getUrl() + " (id " + ss.getId() + ")");
  Logger.log("Photos deleted in Drive leave the gallery within " + minutes + " minutes.");
  Logger.log("Setup done.");
}

function setupFolder(props) {
  let folder = null;
  const configured = String(CONFIG.DRIVE_FOLDER_ID).trim() !== "";
  const id = folderIdFrom(CONFIG.DRIVE_FOLDER_ID) || (configured ? "" : props.getProperty(PROP_FOLDER));
  if (configured && !id) {
    throw new Error("CONFIG.DRIVE_FOLDER_ID is not a Drive folder link or ID: " + CONFIG.DRIVE_FOLDER_ID);
  }
  if (id) {
    try {
      folder = DriveApp.getFolderById(id);
      if (folder.isTrashed()) folder = null;
    } catch (err) {
      folder = null;
    }
    if (!folder && configured) {
      throw new Error("CONFIG.DRIVE_FOLDER_ID (" + id + ") is not a folder this account can use.");
    }
  }
  if (!folder) folder = firstLive(DriveApp.getFoldersByName(CONFIG.FOLDER_NAME), null);
  if (!folder) {
    folder = DriveApp.createFolder(CONFIG.FOLDER_NAME);
    Logger.log("Created the photos folder \"" + CONFIG.FOLDER_NAME + "\".");
  }
  // Anyone with the link can view: the site shows Drive's thumbnails without sign-in.
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty(PROP_FOLDER, folder.getId());
  return folder;
}

// The data spreadsheet stays in My Drive, never in the photos folder (that one is
// viewable by anyone with its link).
function setupDataSheet(props) {
  let ss = null;
  let created = false;
  const id = CONFIG.DATA_SHEET_ID || props.getProperty(PROP_DATA_SHEET);
  if (id) {
    try {
      ss = DriveApp.getFileById(id).isTrashed() ? null : SpreadsheetApp.openById(id);
    } catch (err) {
      ss = null;
    }
    if (!ss && CONFIG.DATA_SHEET_ID) {
      throw new Error("CONFIG.DATA_SHEET_ID (" + id + ") is not a spreadsheet this account can use.");
    }
  }
  if (!ss) {
    const file = firstLive(DriveApp.getFilesByName(CONFIG.DATA_SHEET_NAME), MimeType.GOOGLE_SHEETS);
    if (file) ss = SpreadsheetApp.openById(file.getId());
  }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.DATA_SHEET_NAME);
    created = true;
    Logger.log("Created the data spreadsheet \"" + CONFIG.DATA_SHEET_NAME + "\".");
  }
  Object.keys(SHEET_TABS).forEach((name) => setupTab(ss, name, Object.keys(SHEET_TABS[name])));
  if (created) {
    // A new spreadsheet comes with an empty first tab; only ours are wanted.
    ss.getSheets().forEach((s) => {
      if (!Object.prototype.hasOwnProperty.call(SHEET_TABS, s.getName())) ss.deleteSheet(s);
    });
  }
  props.setProperty(PROP_DATA_SHEET, ss.getId());
  return ss;
}

function setupTab(ss, name, columns) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    const header = sheet.getDataRange().getValues()[0].slice(0, columns.length).map(String);
    if (header.join(",") !== columns.join(",")) {
      Logger.log("Warning: the first row of tab " + name + " should be: " + columns.join(", ") + ".");
    }
  }
  // Text columns as plain text, so Sheets never turns an id or a name into a number,
  // date or formula.
  columns.forEach((col, i) => {
    const kind = SHEET_TABS[name][col];
    if (kind === "text" || kind === "typed") sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat("@");
  });
}

// Replaces any earlier trigger, so changing SYNC_MINUTES and running setup() again works.
function setupTrigger() {
  const t = triggerMinutes(CONFIG.SYNC_MINUTES);
  if (!t.valid) {
    Logger.log("CONFIG.SYNC_MINUTES = " + CONFIG.SYNC_MINUTES + " is not allowed (use one of " +
      TRIGGER_MINUTES_ALLOWED.join(", ") + "); using " + t.minutes + ".");
  }
  ScriptApp.getProjectTriggers().forEach((tr) => {
    if (tr.getHandlerFunction() === SYNC_FUNCTION) ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger(SYNC_FUNCTION).timeBased().everyMinutes(t.minutes).create();
  return t.minutes;
}

// First item of a Drive iterator that is not in the trash, is of `mime` (if given) and
// belongs to CONFIG.OWNER_EMAIL: something with the same name that someone else shared
// with this account is never used.
function firstLive(it, mime) {
  while (it.hasNext()) {
    const x = it.next();
    if (x.isTrashed() || (mime && x.getMimeType() !== mime)) continue;
    if (ownedByOwner(x)) return x;
    Logger.log("Not using \"" + x.getName() + "\" (id " + x.getId() + "): it does not belong to " + CONFIG.OWNER_EMAIL + ".");
  }
  return null;
}

function ownedByOwner(item) {
  let email = "";
  try {
    const owner = item.getOwner();   // null for items in a shared drive
    email = owner ? String(owner.getEmail() || "") : "";
  } catch (err) {
    email = "";
  }
  return email !== "" && email.toLowerCase() === String(CONFIG.OWNER_EMAIL).trim().toLowerCase();
}

function newSecret() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}
