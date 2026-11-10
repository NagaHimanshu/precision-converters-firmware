// Tests for the Apps Script backend (apps-script/*.gs).
// Logic.gs and Config.gs are loaded by run.html as plain scripts, so their functions are
// called directly. Code.gs needs Google's services, so it is run here against small
// in-memory fakes of them: this checks our own logic (rows, paging, cache, lock, setup),
// not Google's behaviour.
(function () {
  "use strict";

  const DEV_A = "a".repeat(32);
  const DEV_B = "b".repeat(32);
  const DEV_C = "c".repeat(32);

  /* ---------- Config.gs ---------- */

  test("config.gs has every setting", function () {
    const keys = ["OWNER_EMAIL", "WEDDING_SHEET_ID", "SETTINGS_TAB", "UPLOADS_KEY", "GOOGLE_CLIENT_ID",
      "FOLDER_NAME", "DATA_SHEET_NAME", "DRIVE_FOLDER_ID", "DATA_SHEET_ID", "STORAGE_WARN_PERCENT",
      "STORAGE_STOP_PERCENT", "MAX_PHOTO_BYTES", "NAME_MAX_LENGTH", "PAGE_SIZE_MAX", "RATE_LIMIT_PER_HOUR",
      "SETTINGS_CACHE_SECONDS", "STORAGE_CACHE_SECONDS", "LIST_CACHE_SECONDS", "SYNC_MINUTES", "LOCK_WAIT_MS",
      "CACHE_CHUNK_BYTES", "TIME_ZONE", "WARN_MAIL_SUBJECT", "WARN_MAIL_BODY", "SYNC_MAX_SECONDS", "TOKENINFO_URL"];
    eq(CONFIG.TOKENINFO_URL, "https://oauth2.googleapis.com/tokeninfo");
    for (const k of keys) ok(k in CONFIG, "CONFIG." + k);
    eq(CONFIG.OWNER_EMAIL, "jahnavirishika6@gmail.com");
    eq(CONFIG.UPLOADS_KEY, "gallery_uploads");
    eq(CONFIG.TIME_ZONE, "Asia/Kolkata");
    ok(CONFIG.CACHE_CHUNK_BYTES <= 100 * 1024, "chunk fits CacheService's value limit");
  });

  /* ---------- Logic.gs ---------- */

  test("cleanName", function () {
    eq(cleanName("  Ravi \n uncle\u0007 ", 40), "Ravi uncle");
    eq(cleanName("a".repeat(300), 40).length, 40);
    eq(Array.from(cleanName("😀".repeat(50), 40)).length, 40);
    eq(cleanName("<img src=x onerror=alert(1)>", 40), "<img src=x onerror=alert(1)>", "markup kept as text");
    eq(cleanName(null, 40), "");
    eq(cleanName("ab" + " ".repeat(5) + "cd", 3), "ab", "no trailing space after the cut");
  });

  test("parseRequest", function () {
    const good = parseRequest(JSON.stringify({ action: "list", device: DEV_A, limit: 30 }));
    eq(good, { action: "list", device: DEV_A, limit: 30 });
    eq(parseRequest("not json"), null);
    eq(parseRequest("[]"), null);
    eq(parseRequest("null"), null);
    eq(parseRequest(JSON.stringify({ device: DEV_A })), null, "missing action");
    eq(parseRequest(JSON.stringify({ action: 5, device: DEV_A })), null, "action not a string");
    eq(parseRequest(JSON.stringify({ action: "list", device: "abc" })), null, "short device");
    eq(parseRequest(JSON.stringify({ action: "list", device: DEV_A.toUpperCase() })), null, "upper-case device");
    eq(parseRequest(undefined), null);
  });

  test("pageOf", function () {
    const items = Array.from({ length: 45 }, (_, i) => i);
    let p = pageOf(items, null, 30, 60);
    eq(p.photos.length, 30);
    eq(p.next, "30");
    p = pageOf(items, "30", 30, 60);
    eq(p.photos, items.slice(30));
    eq(p.next, null);
    p = pageOf(items, "x", 30, 60);
    eq(p.photos[0], 0, "bad cursor starts over");
    eq(pageOf(items, "-5", 30, 60).photos[0], 0, "negative cursor starts over");
    eq(pageOf(items, 30, 30, 60).photos[0], 0, "cursor must be a string");
    eq(pageOf(items, "90", 30, 60), { photos: [], next: null }, "past the end");
    const many = Array.from({ length: 100 }, (_, i) => i);
    p = pageOf(many, null, 500, 60);
    eq(p.photos.length, 60, "limit capped");
    eq(p.next, "60");
  });

  function photoRow(id, at, deviceHash, extra) {
    return Object.assign({ id, at, by: "", deviceHash, accountHash: "", deleted: false }, extra || {});
  }

  test("buildPhotos", function () {
    const photos = [
      photoRow("old", 100, "hA"),
      photoRow("gone", 300, "hA", { deleted: true }),
      photoRow("new", 200, "hB", { by: "Ravi", accountHash: "acc1" }),
      photoRow("other", 150, "hC"),
    ];
    const hearts = [{ id: "new", deviceHash: "hA" }, { id: "new", deviceHash: "hC" }, { id: "old", deviceHash: "hB" }];
    const list = buildPhotos(photos, hearts, { deviceHash: "hA", accountHash: null });
    eq(list.map((p) => p.id), ["new", "other", "old"], "deleted dropped, newest first");
    eq(list[0], { id: "new", by: "Ravi", at: 200, hearts: 2, hearted: true, mine: false });
    eq(list[2], { id: "old", by: "", at: 100, hearts: 1, hearted: false, mine: true }, "mine by device");
    const byAccount = buildPhotos(photos, hearts, { deviceHash: "hZ", accountHash: "acc1" });
    eq(byAccount.filter((p) => p.mine).map((p) => p.id), ["new"], "mine by account");
    const noAccount = buildPhotos(photos, hearts, { deviceHash: "hZ", accountHash: "" });
    eq(noAccount.filter((p) => p.mine).length, 0, "empty account never matches empty account");
    eq(buildPhotos(photos, hearts, { deviceHash: "", accountHash: null }).filter((p) => p.mine).length, 0);
  });

  test("applyHeart", function () {
    const rows = [{ id: "p1", deviceHash: "hA" }, { id: "p2", deviceHash: "hB" }];
    eq(applyHeart(rows, "p2", "hA", true), { add: true, removeIndex: -1 });
    eq(applyHeart(rows, "p1", "hA", true), { add: false, removeIndex: -1 }, "already hearted");
    eq(applyHeart(rows, "p2", "hB", false), { add: false, removeIndex: 1 });
    eq(applyHeart(rows, "p2", "hA", false), { add: false, removeIndex: -1 }, "nothing to remove");
  });

  test("canDelete", function () {
    const row = photoRow("p", 1, "hA", { accountHash: "acc1" });
    eq(canDelete(row, { deviceHash: "hA", accountHash: null }), true, "own device");
    eq(canDelete(row, { deviceHash: "hB", accountHash: null }), false, "other device");
    eq(canDelete(row, { deviceHash: "hB", accountHash: "acc1" }), true, "same account");
    eq(canDelete(photoRow("p", 1, "hA"), { deviceHash: "hB", accountHash: "" }), false, "both accounts empty");
  });

  test("storageState", function () {
    eq(storageState(84, 100, 85, 98), "ok");
    eq(storageState(85, 100, 85, 98), "warn");
    eq(storageState(98, 100, 85, 98), "stop");
    eq(storageState(5, 0, 85, 98), "ok", "no limit");
    eq(storageState(5, -1, 85, 98), "ok");
  });

  test("uploadsOpenFrom", function () {
    eq(uploadsOpenFrom([["gallery_uploads", "no"]], "gallery_uploads"), false);
    eq(uploadsOpenFrom([["key", "value"], [" Gallery_Uploads ", "NO"]], "gallery_uploads"), false);
    eq(uploadsOpenFrom([["gallery_uploads", " off "]], "gallery_uploads"), false);
    eq(uploadsOpenFrom([["gallery_uploads", "hide"]], "gallery_uploads"), false, "same no-words as app.js");
    eq(uploadsOpenFrom([["gallery_uploads", "HIDE"]], "gallery_uploads"), false);
    for (const w of ["n", "false", "0"]) eq(uploadsOpenFrom([["gallery_uploads", w]], "gallery_uploads"), false, w);
    eq(uploadsOpenFrom([["gallery_uploads", "yes"]], "gallery_uploads"), true);
    eq(uploadsOpenFrom([["gallery_uploads", ""]], "gallery_uploads"), true);
    eq(uploadsOpenFrom([["bride", "Ananya"]], "gallery_uploads"), true, "missing key");
    eq(uploadsOpenFrom([], "gallery_uploads"), true);
    eq(uploadsOpenFrom([["gallery_uploads"]], "gallery_uploads"), true, "short row");
  });

  test("isJpeg", function () {
    eq(isJpeg([0xFF, 0xD8, 0xFF, 0xE0]), true);
    eq(isJpeg([-1, -40, -1]), true, "signed bytes");
    eq(isJpeg([0x89, 0x50, 0x4E, 0x47]), false, "png");
    eq(isJpeg([0xFF, 0xD8]), false, "too short");
    eq(isJpeg(null), false);
  });

  test("checkTokenInfo", function () {
    const now = 1000;
    const good = { aud: "cid", iss: "https://accounts.google.com", exp: "2000", sub: "123", name: "Ravi", email: "x@y" };
    eq(checkTokenInfo(good, "cid", now), { sub: "123", name: "Ravi" });
    eq(checkTokenInfo(Object.assign({}, good, { iss: "accounts.google.com" }), "cid", now), { sub: "123", name: "Ravi" });
    eq(checkTokenInfo(Object.assign({}, good, { name: undefined }), "cid", now), { sub: "123", name: "" });
    eq(checkTokenInfo(Object.assign({}, good, { aud: "other" }), "cid", now), null, "wrong aud");
    eq(checkTokenInfo(Object.assign({}, good, { iss: "evil.com" }), "cid", now), null, "wrong iss");
    eq(checkTokenInfo(Object.assign({}, good, { exp: "1000" }), "cid", now), null, "expired");
    eq(checkTokenInfo(Object.assign({}, good, { sub: "" }), "cid", now), null, "missing sub");
    eq(checkTokenInfo(good, "", now), null, "no client id configured");
    eq(checkTokenInfo(null, "cid", now), null);
  });

  test("driveErrorCode", function () {
    eq(driveErrorCode("Storage quota exceeded"), "full");
    eq(driveErrorCode("Exception: The user's Drive storage quota has been exceeded."), "full");
    eq(driveErrorCode("Limit Exceeded: DriveApp."), "busy", "a rate limit is not a full album");
    eq(driveErrorCode("User rate limit exceeded."), "busy");
    eq(driveErrorCode("Rate Limit Exceeded"), "busy");
    eq(driveErrorCode("Service invoked too many times for one day: driveapp."), "busy");
    eq(driveErrorCode("Too many requests per second"), "busy");
    eq(driveErrorCode("Quota exceeded: requests per minute"), "busy", "rate wording wins over quota");
    eq(driveErrorCode("Service unavailable"), "");
    eq(driveErrorCode(""), "");
    eq(driveErrorCode(undefined), "");
  });

  test("photoFileName", function () {
    eq(photoFileName("20261109-143005", "3F2A9C1E-7b6d-4c1a-9e2f-0a1b2c3d4e5f"), "20261109-143005-3f2a9c.jpg");
    ok(/^x-[0-9a-f]{6}\.jpg$/.test(photoFileName("x", "0123-4567-89ab")), "dashes skipped");
  });

  test("folderIdFrom", function () {
    const ID = "1AbC_dEf-GhIjKlMnOpQrStUvWxYz012";
    eq(folderIdFrom(ID), ID, "bare id");
    eq(folderIdFrom("  " + ID + " \n"), ID, "trimmed");
    eq(folderIdFrom("https://drive.google.com/drive/folders/" + ID + "?usp=sharing"), ID);
    eq(folderIdFrom("https://drive.google.com/drive/folders/" + ID), ID);
    eq(folderIdFrom("https://drive.google.com/drive/u/0/folders/" + ID), ID);
    eq(folderIdFrom("https://drive.google.com/open?id=" + ID), ID);
    eq(folderIdFrom("https://drive.google.com/open?usp=sharing&id=" + ID + "&x=1"), ID);
    eq(folderIdFrom(""), "");
    eq(folderIdFrom("   "), "");
    eq(folderIdFrom(null), "");
    eq(folderIdFrom(undefined), "");
    eq(folderIdFrom("https://example.com/nothing/here"), "", "unrecognised");
    eq(folderIdFrom("not an id"), "", "unrecognised");
  });

  test("fillText", function () {
    eq(fillText("{percent}% full: {used} of {limit} GB ({other})", { percent: 90, used: "13.5", limit: "15.0" }),
      "90% full: 13.5 of 15.0 GB ({other})", "unknown placeholders kept");
    eq(fillText("no placeholders", {}), "no placeholders");
  });

  test("countRecent", function () {
    const rows = [photoRow("1", 100, "hA"), photoRow("2", 200, "hA"), photoRow("3", 300, "hB"),
      photoRow("4", 250, "hA", { deleted: true })];
    eq(countRecent(rows, "hA", 200), 2, "deleted uploads still count");
    eq(countRecent(rows, "hB", 200), 1);
    eq(countRecent(rows, "hC", 0), 0);
  });

  test("fail", function () {
    eq(fail("busy"), { ok: false, code: "busy" });
  });

  test("rowObjects and rowValues", function () {
    const values = [
      ["id", "at", "by", "deviceHash", "accountHash", "deleted"],
      ["p1", 5, "Ravi", "hA", "", false],
      ["", "", "", "", "", ""],
      [123, "7", "", "hB", "", "TRUE"],
    ];
    eq(rowObjects(values, SHEET_TABS.Photos), [
      { id: "p1", at: 5, by: "Ravi", deviceHash: "hA", accountHash: "", deleted: false, row: 2 },
      { id: "123", at: 7, by: "", deviceHash: "hB", accountHash: "", deleted: true, row: 4 },
    ]);
    eq(rowObjects([[""]], SHEET_TABS.Hearts), [], "empty sheet");
    const marks = [true, "TRUE", false, "", "FALSE", "sync", " Sync "].map((x, i) => ["p" + i, 1, "", "h", "", x]);
    eq(rowObjects([values[0]].concat(marks), SHEET_TABS.Photos).map((r) => r.deleted),
      [true, true, false, false, false, "sync", "sync"], "deleted for good, live, hidden by the sync");
    eq([true, "sync", false, "x"].map((x) => rowValues({ id: "p", deleted: x }, SHEET_TABS.Photos)[5]),
      [true, "sync", false, false]);
    eq(rowValues({ id: "p", at: 9, by: "=HYPERLINK(1)", deviceHash: "hA" }, SHEET_TABS.Photos),
      ["p", 9, "'=HYPERLINK(1)", "hA", "", false], "typed text can't become a formula");
  });

  test("rowObjects drops the formula guard from typed text", function () {
    const values = [
      ["id", "at", "by", "deviceHash", "accountHash", "deleted"],
      ["'=x", 1, "'=HYPERLINK(1)", "hA", "", false],
      ["p2", 2, "'+91 uncle", "hA", "", false],
      ["p3", 3, "'Ravi", "hA", "", false],
      ["p4", 4, "''=x", "hA", "", false],
      ["p5", 5, "=1+1", "hA", "", false],
      ["p6", 6, "'@home", "hA", "", false],
    ];
    eq(rowObjects(values, SHEET_TABS.Photos).map((r) => r.by),
      ["=HYPERLINK(1)", "+91 uncle", "'Ravi", "''=x", "=1+1", "@home"], "only one guard, only before a formula start");
    eq(rowObjects(values, SHEET_TABS.Photos)[0].id, "'=x", "only typed columns");
    eq(rowObjects([["deviceHash", "accountHash", "name", "linkedAt"], ["h", "a", "'-Ravi", 1]], SHEET_TABS.Devices)[0].name,
      "-Ravi");
    const typed = ["=1+1", "-Ravi", "Ravi", "'quoted"];
    eq(rowObjects([Object.keys(SHEET_TABS.Photos)].concat(typed.map((t) => rowValues({ id: "p", by: t }, SHEET_TABS.Photos))),
      SHEET_TABS.Photos).map((r) => r.by), typed, "round trip");
  });

  test("cellText", function () {
    eq(cellText("=1+1"), "'=1+1");
    eq(cellText("+91 uncle"), "'+91 uncle");
    eq(cellText("-Ravi"), "'-Ravi");
    eq(cellText("@home"), "'@home");
    eq(cellText("Ravi"), "Ravi");
  });

  test("cache parts round trip", function () {
    const text = asciiJson([{ by: "రవి 😀", id: "p1" }, { by: "x".repeat(500) }]);
    ok(/^[\x00-\x7f]*$/.test(text), "ascii only");
    eq(JSON.parse(text)[0].by, "రవి 😀");
    const { head, parts } = toCacheParts(text, 100, "s1");
    ok(parts.length > 1, "split");
    ok(parts.every((p) => p.length <= 100), "every part within the chunk size");
    eq(fromCacheParts(head, parts), text);
    eq(cachePartCount(head), parts.length);
    eq(cachePartCount("junk"), 0);
    eq(fromCacheParts(head, parts.slice(0, -1).concat([null])), null, "missing part");
    const other = toCacheParts(text, 100, "s2");
    eq(fromCacheParts(head, [other.parts[0]].concat(parts.slice(1))), null, "part from another write");
    eq(fromCacheParts("junk", parts), null);
    eq(fromCacheParts(null, parts), null);
    const empty = toCacheParts("[]", 100, "s3");
    eq(fromCacheParts(empty.head, empty.parts), "[]");
  });

  test("apps-script files are plain ASCII", async function () {
    // Copy-paste into the Apps Script editor must not change any character.
    for (const f of ["Config.gs", "Logic.gs", "Code.gs"]) {
      const res = await fetch("/apps-script/" + f, { cache: "no-store" });
      const text = await res.text();
      const bad = text.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /[^\x00-\x7f]/.test(l));
      eq(bad.map(([n]) => f + ":" + n), [], f + " has only ASCII characters");
    }
  });

  test("triggerMinutes", function () {
    eq(triggerMinutes(15), { minutes: 15, valid: true });
    eq(triggerMinutes(1), { minutes: 1, valid: true });
    eq(triggerMinutes(7), { minutes: 15, valid: false });
    eq(triggerMinutes("5"), { minutes: 15, valid: false });
  });

  test("driveNotFound", function () {
    ok(driveNotFound("Exception: No item with the given ID could be found. Possibly because you have not edited this item or you do not have permission to access it."));
    ok(driveNotFound("File not found: 1abc"));
    ok(driveNotFound("Requested entity was not found."));
    ok(!driveNotFound("Service unavailable"));
    ok(!driveNotFound("Access denied: DriveApp."));
    ok(!driveNotFound(undefined));
  });

  test("syncChanges", function () {
    const rows = [photoRow("live", 100, "hA"), photoRow("gone", 100, "hA"), photoRow("young", 900, "hA"),
      photoRow("deleted", 100, "hA", { deleted: true }), photoRow("", 100, "hA"),
      photoRow("hidden", 100, "hA", { deleted: "sync" }), photoRow("back", 100, "hA", { deleted: "sync" })];
    const ids = (c) => [c.hide.map((r) => r.id), c.show.map((r) => r.id)];
    eq(ids(syncChanges(rows, new Set(["live", "deleted", "back"]), 500)), [["gone"], ["back"]],
      "missing files hidden; a sync-hidden row whose file is back is shown; deleted, too young and id-less rows left alone");
    eq(ids(syncChanges(rows, new Set(["live", "gone", "young"]), 1000)), [[], []]);
    eq(ids(syncChanges(rows, new Set(), 500)), [["live", "gone"], []], "an empty folder hides everything old enough");
  });

  /* ---------- Code.gs against fake Google services ---------- */

  const GOOGLE = ["SpreadsheetApp", "DriveApp", "PropertiesService", "CacheService", "LockService",
    "Utilities", "ContentService", "Logger", "ScriptApp", "MailApp", "UrlFetchApp", "MimeType", "Session", "console"];
  const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
  let codeText = null;

  async function codeSource() {
    if (codeText === null) {
      const res = await fetch("/apps-script/Code.gs", { cache: "no-store" });
      if (!res.ok) throw new Error("Code.gs not found");
      codeText = await res.text();
    }
    return codeText;
  }

  // Code.gs with the given fakes in place of Google's globals.
  async function codeWith(env) {
    const text = await codeSource();
    const make = new Function(...GOOGLE, text +
      "\n;return { doPost: doPost, doGet: doGet, setup: setup, syncDeletions: syncDeletions, hash: hash };");
    return make(...GOOGLE.map((n) => env[n]));
  }

  function fakeSheet(name, rows) {
    rows = rows || [];
    return {
      rows,
      reads: 0,
      getName: () => name,
      getDataRange() {
        const self = this;
        return { getValues() { self.reads++; return rows.length ? rows.map((r) => r.slice()) : [[""]]; } };
      },
      getLastRow: () => rows.length,
      getMaxRows: () => Math.max(1000, rows.length),
      appendRow(r) { rows.push(r.slice()); return this; },
      deleteRow(n) { rows.splice(n - 1, 1); },
      getRange(r, c, nr, nc) {
        return {
          setValues(v) { v.forEach((line, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; line.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }); return this; },
        setValue(x) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = x; return this; },
          setNumberFormat() { return this; },
          setFontWeight() { return this; },
        };
      },
      setFrozenRows() { return this; },
    };
  }

  function fakeSpreadsheet(id, name, tabs) {
    const sheets = Object.entries(tabs || {}).map(([n, rows]) => fakeSheet(n, rows));
    return {
      id, name, sheets,
      getId: () => id,
      getName: () => name,
      getUrl: () => "https://docs/" + id,
      getSheets: () => sheets.slice(),
      getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
      insertSheet(n) { const s = fakeSheet(n); sheets.push(s); return s; },
      deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); },
      tab(n) { const s = sheets.find((x) => x.getName() === n); return s && s.rows; },
    };
  }

  function iter(list) {
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  }

  // A fake Google: script properties, cache, lock, Drive, Sheets, triggers, logs.
  function fakeGoogle(o) {
    o = o || {};
    const props = Object.assign({ HASH_SECRET: "secret", DATA_SHEET_ID: "data1" }, o.props);
    if (o.noSecret) delete props.HASH_SECRET;
    const cache = new Map();
    const spreadsheets = {};
    const folders = [];
    const files = [];
    const triggers = [];
    const logs = [];
    const errors = [];
    const mails = [];
    const fetches = [];
    const lock = { held: false, tries: 0 };
    const events = [];   // lock / flush / cache removal order
    let nextId = 1;

    spreadsheets.data1 = fakeSpreadsheet("data1", "Fixture data", {
      Photos: [["id", "at", "by", "deviceHash", "accountHash", "deleted"]].concat(o.photos || []),
      Hearts: [["id", "deviceHash", "at"]].concat(o.hearts || []),
      Devices: [["deviceHash", "accountHash", "name", "linkedAt"]].concat(o.devices || []),
    });
    if (!o.noSettings) {
      spreadsheets[CONFIG.WEDDING_SHEET_ID] = fakeSpreadsheet(CONFIG.WEDDING_SHEET_ID, "Wedding", {
        [CONFIG.SETTINGS_TAB]: [["key", "value"]].concat(o.settings || []),
      });
    }

    // Drive's owner of an item: a user, or null (e.g. a shared drive).
    function ownerOf(email) {
      return email === null ? null : { getEmail: () => email };
    }

    function newFolder(name, owner) {
      const f = {
        id: "folder" + nextId++, name, trashed: false, sharing: null, files: [],
        owner: owner === undefined ? CONFIG.OWNER_EMAIL : owner,
        getId() { return this.id; }, getName() { return this.name; },
        getUrl() { return "https://drive/" + this.id; }, isTrashed() { return this.trashed; },
        getOwner() { return ownerOf(this.owner); },
        setSharing(a, p) { this.sharing = [a, p]; return this; },
        createFile(blob) {
          events.push("createFile");
          if (o.createFileError) throw new Error(o.createFileError);
          return this.addFile("file" + nextId++, blob.getName(), blob.getContentType(), blob.getBytes());
        },
        addFile(id, name, mime, bytes) {
          const file = {
            id, name: name || id + ".jpg", mime: mime || "image/jpeg", bytes: bytes || [], trashed: false,
            getId() { return this.id; },
            isTrashed() { return this.trashed; },
            setTrashed(t) {
              events.push("trash " + this.id);
              if (o.trashError) throw new Error(o.trashError);
              this.trashed = t;
              return this;
            },
          };
          this.files.push(file);
          return file;
        },
        // Drive search inside the folder; only "trashed = false" is used by Code.gs.
        searchFiles(q) {
          events.push("search " + q);
          if (o.searchError) throw new Error(o.searchError);
          const live = this.files.filter((x) => (q === "trashed = false" ? !x.trashed : true));
          let i = 0;
          return {
            hasNext: () => i < live.length,
            next() {
              if (o.searchFailsAt != null && i === o.searchFailsAt) throw new Error("Drive hiccup while listing");
              return live[i++];
            },
          };
        },
      };
      folders.push(f);
      return f;
    }

    // Drive's message for an id it doesn't know.
    const NO_ITEM = "No item with the given ID could be found. Possibly because you have not edited this item or you do not have permission to access it.";

    function newSheet(name, owner) {
      const id = "sheet" + nextId++;
      spreadsheets[id] = fakeSpreadsheet(id, name, { Sheet1: [] });
      owner = owner === undefined ? CONFIG.OWNER_EMAIL : owner;
      files.push({ getId: () => id, getMimeType: () => SHEETS_MIME, isTrashed: () => false, getName: () => name,
        getOwner: () => ownerOf(owner) });
      return spreadsheets[id];
    }

    if (o.folder) props.FOLDER_ID = newFolder(CONFIG.FOLDER_NAME).getId();

    // Apps Script's Utilities.formatDate for the patterns Code.gs uses.
    function formatDate(date, tz, pattern) {
      const p = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        .formatToParts(date).forEach((x) => { p[x.type] = x.value; });
      const map = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
      return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => map[t]);
    }

    function uuid() {
      const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
    }

    function hmac(value, key) {
      // Not HMAC: a stable 32-byte mix of key and value, signed bytes like Apps Script.
      const out = [];
      let h = 2166136261;
      const s = key + "|" + value;
      for (let i = 0; i < 32; i++) {
        for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j) ^ i, 16777619);
        out.push(((h >>> 0) % 256) - 128);
      }
      return out;
    }

    const env = {
      state: { props, cache, spreadsheets, folders, files, triggers, logs, errors, lock, events, mails, fetches,
        addFolder: (name, owner) => newFolder(name, owner),
        addSheetFile: (name, owner) => newSheet(name, owner) },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => (k in props ? props[k] : null),
          getProperties: () => Object.assign({}, props),
          setProperty(k, v) { props[k] = String(v); return this; },
        }),
      },
      CacheService: {
        getScriptCache: () => ({
          get: (k) => (cache.has(k) ? cache.get(k) : null),
          getAll(keys) { const out = {}; keys.forEach((k) => { if (cache.has(k)) out[k] = cache.get(k); }); return out; },
          put(k, v, t) {
            if (String(v).length > 100 * 1024) throw new Error("Argument too large");
            if (!(t > 0 && t <= 21600)) throw new Error("bad expiration " + t);
            cache.set(k, String(v));
          },
          putAll(m, t) { Object.keys(m).forEach((k) => this.put(k, m[k], t)); },
          remove: (k) => { events.push("remove " + k); cache.delete(k); },
          removeAll: (ks) => { ks.forEach((k) => cache.delete(k)); },
        }),
      },
      LockService: {
        getScriptLock: () => ({
          tryLock() { lock.tries++; if (o.lockBusy || lock.held) return false; lock.held = true; events.push("lock"); return true; },
          releaseLock() { lock.held = false; events.push("release"); },
        }),
      },
      SpreadsheetApp: {
        flush() { events.push("flush"); },
        openById(id) {
          if (o.sheetsDown || !spreadsheets[id]) throw new Error("Spreadsheet not found: " + id);
          return spreadsheets[id];
        },
        create: (name) => newSheet(name),
      },
      DriveApp: {
        Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" },
        Permission: { VIEW: "VIEW" },
        getStorageUsed: () => (o.used != null ? o.used : 10),
        getStorageLimit: () => (o.limit != null ? o.limit : 100),
        getFolderById(id) { const f = folders.find((x) => x.id === id); if (!f) throw new Error("No folder " + id); return f; },
        getFoldersByName: (n) => iter(folders.filter((f) => f.name === n)),
        createFolder: (n) => newFolder(n),
        getFilesByName: (n) => iter(files.filter((f) => f.getName() === n)),
        getFileById(id) {
          const f = files.find((x) => x.getId() === id) ||
            [].concat(...folders.map((d) => d.files)).find((x) => x.getId() === id);
          if (!f) throw new Error(NO_ITEM);
          return f;
        },
      },
      MimeType: { GOOGLE_SHEETS: SHEETS_MIME, JPEG: "image/jpeg" },
      Utilities: {
        computeHmacSha256Signature: hmac,
        base64EncodeWebSafe: (bytes) => btoa(String.fromCharCode(...bytes.map((b) => b & 255)))
          .replace(/\+/g, "-").replace(/\//g, "_"),
        getUuid: uuid,
        formatDate,
        // Like Apps Script: signed bytes; malformed text throws.
        base64Decode(text) {
          const bin = atob(text);
          const out = new Int8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        },
        newBlob: (bytes, type, name) => ({ getBytes: () => bytes, getContentType: () => type, getName: () => name }),
      },
      Session: { getScriptTimeZone: () => "Asia/Kolkata" },
      MailApp: {
        sendEmail(to, subject, body) {
          if (o.mailError) throw new Error(o.mailError);
          mails.push({ to, subject, body });
        },
      },
      ContentService: {
        MimeType: { JSON: "JSON-MIME" },
        createTextOutput: (s) => ({
          content: s, mime: null,
          setMimeType(m) { this.mime = m; return this; },
          getContent() { return this.content; },
        }),
      },
      Logger: { log: (...a) => { logs.push(a.join(" ")); } },
      ScriptApp: {
        getProjectTriggers: () => triggers.slice(),
        deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
        newTrigger: (fn) => ({
          timeBased: () => ({
            everyMinutes: (n) => ({
              create() { const t = { fn, n, getHandlerFunction: () => fn }; triggers.push(t); return t; },
            }),
          }),
        }),
      },
      // Google's tokeninfo: o.tokeninfo(token) -> { code, body } (or throws, like a failed fetch).
      UrlFetchApp: {
        fetch(url, opts) {
          events.push("fetch");
          fetches.push({ url, opts });
          const token = opts && opts.payload ? String(opts.payload.id_token || "") : "";
          const r = o.tokeninfo ? o.tokeninfo(token) : { code: 400, body: "{\"error\":\"invalid_token\"}" };
          return { getResponseCode: () => r.code, getContentText: () => r.body };
        },
      },
      console: {
        log: (...a) => { logs.push(a.join(" ")); },
        warn: (...a) => { logs.push(a.join(" ")); },
        error: (...a) => { errors.push(a.map(String).join(" ")); },
      },
    };
    return env;
  }

  // POST one request; resolves { body, mime }.
  async function post(env, obj) {
    const code = await codeWith(env);
    const out = code.doPost({ postData: { contents: typeof obj === "string" ? obj : JSON.stringify(obj) } });
    return { body: JSON.parse(out.getContent()), mime: out.mime };
  }

  async function hashOf(env, value) {
    return (await codeWith(env)).hash(value);
  }

  // `count` photo rows from device hash `hA`, newest = p000.
  function seedPhotos(count, hA) {
    return Array.from({ length: count }, (_, i) =>
      ["p" + String(i).padStart(3, "0"), 1000000 - i * 1000, i % 3 ? "Guest " + i : "", hA, "", false]);
  }

  test("code.gs parses", async function () {
    const text = await codeSource();
    const run = new Function(...GOOGLE, text);   // throws on a syntax error
    run();   // all Google globals undefined: top level must not call any of them
  });

  test("code.gs shares one scope with Logic.gs", async function () {
    // Apps Script puts every .gs file in one global scope: a const declared twice fails,
    // a function declared twice silently replaces the first. Load Code.gs like that here.
    const logicFns = ["cleanName", "parseRequest", "pageOf", "buildPhotos", "applyHeart", "canDelete",
      "storageState", "uploadsOpenFrom", "isJpeg", "checkTokenInfo", "countRecent", "fail",
      "rowObjects", "rowValues", "cellText", "asciiJson", "toCacheParts", "fromCacheParts", "cachePartCount",
      "triggerMinutes", "driveErrorCode", "photoFileName", "fillText", "driveNotFound", "syncChanges", "folderIdFrom"];
    const before = logicFns.map((n) => self[n]);
    ok(before.every((f) => typeof f === "function"), "Logic.gs functions are global");
    let scriptError = null;
    const onError = (e) => { scriptError = e.message; };
    self.addEventListener("error", onError);
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/apps-script/Code.gs?scope";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Code.gs did not load"));
        document.head.appendChild(s);
      });
    } finally {
      self.removeEventListener("error", onError);
    }
    eq(scriptError, null, "Code.gs loads beside Logic.gs");
    logicFns.forEach((n, i) => ok(self[n] === before[i], n + " not redefined by Code.gs"));
    ok(typeof self.doPost === "function" && typeof self.setup === "function", "Code.gs entry points");
  });

  test("code.gs doGet health check", async function () {
    const env = fakeGoogle();
    const out = (await codeWith(env)).doGet({});
    eq(JSON.parse(out.getContent()), { ok: true, service: "gallery" });
    eq(out.mime, "JSON-MIME");
  });

  test("code.gs bad requests are invalid", async function () {
    const env = fakeGoogle();
    eq((await post(env, "not json")).body, { ok: false, code: "invalid" });
    eq((await post(env, { action: "list", device: "abc", limit: 30 })).body, { ok: false, code: "invalid" });
    eq((await post(env, { action: "explode", device: DEV_A })).body, { ok: false, code: "invalid" });
    eq((await post(env, { action: "toString", device: DEV_A })).body, { ok: false, code: "invalid" }, "no prototype actions");
    eq((await post(env, { action: "list", device: DEV_A })).body, { ok: false, code: "invalid" }, "limit missing");
    eq((await post(env, { action: "list", device: DEV_A, limit: 0 })).body, { ok: false, code: "invalid" });
    const none = (await codeWith(env)).doPost(undefined);
    eq(JSON.parse(none.getContent()), { ok: false, code: "invalid" }, "no body at all");
    eq(none.mime, "JSON-MIME");
  });

  test("code.gs link needs a token", async function () {
    const env = fakeGoogle();
    for (const idToken of [undefined, "", 42, { x: 1 }]) {
      eq((await post(env, { action: "link", device: DEV_A, idToken })).body, { ok: false, code: "invalid" }, String(idToken));
    }
    eq(env.state.fetches.length, 0, "Google not asked");
  });

  test("code.gs without setup is unavailable", async function () {
    const env = fakeGoogle({ noSecret: true });
    const r = await post(env, { action: "list", device: DEV_A, limit: 30 });
    eq(r.body, { ok: false, code: "unavailable" });
    eq(r.mime, "JSON-MIME");
    ok(env.state.errors.some((e) => /setup\(\)/.test(e)), "logs: run setup()");
    const env2 = fakeGoogle({ props: { DATA_SHEET_ID: "" } });
    eq((await post(env2, { action: "list", device: DEV_A, limit: 30 })).body, { ok: false, code: "unavailable" });
    ok(env2.state.errors.some((e) => /setup\(\)/.test(e)), "logs: run setup() for a missing data sheet");
  });

  test("code.gs failures inside become unavailable", async function () {
    const env = fakeGoogle({ sheetsDown: true });
    const r = await post(env, { action: "list", device: DEV_A, limit: 30 });
    eq(r.body, { ok: false, code: "unavailable" });
    ok(env.state.errors.length > 0, "console.error called");
  });

  test("code.gs hashes are sheet-safe", async function () {
    const env = fakeGoogle();
    for (let i = 0; i < 300; i++) {
      const h = await hashOf(env, i.toString(16).padStart(32, "0"));
      ok(/^[A-Za-z0-9_]/.test(h) && !/=$/.test(h), "hash " + h + " can't be read as a formula");
    }
    ok((await hashOf(env, DEV_A)) !== (await hashOf(env, DEV_B)), "different devices, different hashes");
  });

  test("code.gs list pages like the stand-in", async function () {
    const base = fakeGoogle();
    const hA = await hashOf(base, DEV_A);
    const photos = seedPhotos(45, hA).concat([["gone", 2000000, "", hA, "", true]]);
    const env = fakeGoogle({ photos, hearts: [["p001", "x", 1], ["p001", hA, 2]] });
    let r = (await post(env, { action: "list", device: DEV_B, limit: 30 })).body;
    eq(Object.keys(r), ["ok", "photos", "next", "total", "uploadsOpen", "full", "account"]);
    eq(r.photos.length, 30);
    eq(r.next, "30");
    eq(r.total, 45);
    eq([r.uploadsOpen, r.full, r.account], [true, false, null]);
    eq(r.photos[0].id, "p000", "newest first, deleted dropped");
    eq(Object.keys(r.photos[0]), ["id", "by", "at", "hearts", "hearted", "mine"]);
    eq(r.photos[1], { id: "p001", by: "Guest 1", at: 999000, hearts: 2, hearted: false, mine: false });
    r = (await post(env, { action: "list", device: DEV_B, limit: 30, cursor: r.next })).body;
    eq(r.photos.length, 15);
    eq(r.next, null);
    r = (await post(env, { action: "list", device: DEV_A, limit: 500, cursor: "zz" })).body;
    eq(r.photos.length, 45, "bad cursor starts from 0; a huge limit is fine");
    eq(r.photos[1].hearted, true, "hearted by this device");
    eq(r.photos[0].mine, true);
  });

  test("code.gs list mine", async function () {
    const base = fakeGoogle();
    const hA = await hashOf(base, DEV_A);
    const hB = await hashOf(base, DEV_B);
    const hC = await hashOf(base, DEV_C);
    const photos = [
      ["a1", 10, "", hA, "", false],
      ["b1", 20, "", hB, "", false],
      ["c1", 30, "", hC, "acc", false],
      ["a2", 40, "", hA, "", true],
    ];
    // Device A is linked to account "acc", so C's photo (same account) is A's too.
    const env = fakeGoogle({ photos, devices: [[hA, "acc", "Ravi", 5]] });
    let r = (await post(env, { action: "list", device: DEV_A, limit: 30, mine: true })).body;
    eq(r.photos.map((p) => p.id), ["c1", "a1"]);
    eq(r.total, 2, "total counts the listed tab");
    eq(r.account, { name: "Ravi" });
    r = (await post(env, { action: "list", device: DEV_B, limit: 30, mine: true })).body;
    eq(r.photos.map((p) => p.id), ["b1"]);
    eq(r.account, null);
  });

  test("code.gs heart on and off", async function () {
    const base = fakeGoogle();
    const hB = await hashOf(base, DEV_B);
    const env = fakeGoogle({ photos: seedPhotos(3, hB), hearts: [["p001", "x", 1]] });
    const hearts = () => env.state.spreadsheets.data1.tab("Hearts");
    const heartOf = async () => {
      const p = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body.photos[1];
      return [p.id, p.hearts, p.hearted];
    };
    eq(await heartOf(), ["p001", 1, false]);   // also fills the cache
    env.state.events.length = 0;
    let r = (await post(env, { action: "heart", device: DEV_A, id: "p001", on: true })).body;
    eq(r, { ok: true, hearts: 2, hearted: true });
    eq(env.state.events, ["lock", "flush", "remove rows:Hearts:n", "release"], "flushed and cache dropped before unlock");
    eq(await heartOf(), ["p001", 2, true], "list sees the heart");
    r = (await post(env, { action: "heart", device: DEV_A, id: "p001", on: true })).body;
    eq(r, { ok: true, hearts: 2, hearted: true }, "second on adds nothing");
    eq(hearts().length, 3, "header + 2 hearts");
    r = (await post(env, { action: "heart", device: DEV_A, id: "p001", on: false })).body;
    eq(r, { ok: true, hearts: 1, hearted: false });
    eq(await heartOf(), ["p001", 1, false], "list sees the heart gone");
    r = (await post(env, { action: "heart", device: DEV_A, id: "p001", on: false })).body;
    eq(r, { ok: true, hearts: 1, hearted: false }, "second off removes nothing");
    eq(hearts().length, 2);
    eq(hearts()[1][0], "p001", "the other guest's heart stays");
    eq(env.state.lock.held, false, "lock released");
  });

  test("code.gs heart rejects bad input", async function () {
    const env = fakeGoogle({ photos: [["p1", 1, "", "h", "", false], ["gone", 2, "", "h", "", true]] });
    eq((await post(env, { action: "heart", device: DEV_A, id: "nope", on: true })).body, { ok: false, code: "invalid" });
    eq((await post(env, { action: "heart", device: DEV_A, id: "gone", on: true })).body, { ok: false, code: "invalid" });
    eq((await post(env, { action: "heart", device: DEV_A, id: "p1", on: "yes" })).body, { ok: false, code: "invalid" });
    eq((await post(env, { action: "heart", device: DEV_A, on: true })).body, { ok: false, code: "invalid" });
    eq(env.state.spreadsheets.data1.tab("Hearts").length, 1, "nothing written");
  });

  test("code.gs busy lock", async function () {
    const env = fakeGoogle({ photos: [["p1", 1, "", "h", "", false]], lockBusy: true });
    eq((await post(env, { action: "heart", device: DEV_A, id: "p1", on: true })).body, { ok: false, code: "busy" });
    eq(env.state.lock.tries, 1, "tried the lock");
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.ok, true, "reads need no lock");
  });

  test("code.gs lock released after a failed write", async function () {
    const env = fakeGoogle({ photos: [["p1", 1, "", "h", "", false]] });
    env.state.spreadsheets.data1.getSheetByName("Hearts").appendRow = () => { throw new Error("Sheets hiccup"); };
    eq((await post(env, { action: "heart", device: DEV_A, id: "p1", on: true })).body, { ok: false, code: "unavailable" });
    eq(env.state.lock.held, false);
  });

  test("code.gs paused, full and settings glitches", async function () {
    let env = fakeGoogle({ settings: [[" Gallery_Uploads ", "No"]], used: 99, limit: 100 });
    let r = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq([r.uploadsOpen, r.full], [false, true]);
    env = fakeGoogle({ settings: [["gallery_uploads", "yes"]], used: 90, limit: 100 });
    r = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq([r.uploadsOpen, r.full], [true, false], "warn level is not full");
    env = fakeGoogle({ noSettings: true });
    r = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq([r.ok, r.uploadsOpen], [true, true], "settings sheet unreadable: uploads stay open");
    env = fakeGoogle();
    env.DriveApp.getStorageUsed = () => { throw new Error("Drive hiccup"); };
    r = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq([r.ok, r.full], [true, false], "storage check failing: not full");
    env = fakeGoogle({ settings: [["gallery_uploads", "hide"]] });
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.uploadsOpen, false, "hide = paused");
  });

  test("code.gs remembers an unreadable settings sheet", async function () {
    const env = fakeGoogle({ noSettings: true });
    let opens = 0;
    const open = env.SpreadsheetApp.openById;
    env.SpreadsheetApp.openById = (id) => { if (id === CONFIG.WEDDING_SHEET_ID) opens++; return open(id); };
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.uploadsOpen, true);
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.uploadsOpen, true);
    eq(opens, 1, "a broken WEDDING_SHEET_ID is not opened again on every request");
  });

  test("code.gs caches settings", async function () {
    const env = fakeGoogle({ settings: [["gallery_uploads", "no"]] });
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.uploadsOpen, false);
    env.state.spreadsheets[CONFIG.WEDDING_SHEET_ID].tab(CONFIG.SETTINGS_TAB)[1][1] = "yes";
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.uploadsOpen, false, "cached");
  });

  test("code.gs list cache in chunks", async function () {
    const saved = CONFIG.CACHE_CHUNK_BYTES;
    CONFIG.CACHE_CHUNK_BYTES = 300;
    try {
      const photos = seedPhotos(20, "h").map((r, i) => (i === 2 ? [r[0], r[1], "రవి 😀", r[3], r[4], r[5]] : r));
      const env = fakeGoogle({ photos });
      const sheet = env.state.spreadsheets.data1.getSheetByName("Photos");
      const first = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
      eq(sheet.reads, 1);
      const parts = [...env.state.cache.entries()].filter(([k]) => /^rows:Photos:\d+$/.test(k));
      ok(parts.length > 1, "split into several chunks");
      ok(parts.every(([, v]) => v.length <= 300), "chunks within CACHE_CHUNK_BYTES");
      ok(env.state.cache.has("rows:Photos:n"), "head key");
      const second = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
      eq(sheet.reads, 1, "second list served from cache");
      eq(second, first);
      eq(second.photos[2].by, "రవి 😀");
      env.state.cache.delete("rows:Photos:1");
      const third = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
      eq(sheet.reads, 2, "a lost chunk means a fresh read");
      eq(third, first);
    } finally {
      CONFIG.CACHE_CHUNK_BYTES = saved;
    }
  });

  test("code.gs setup twice is safe", async function () {
    const env = fakeGoogle({ props: { DATA_SHEET_ID: "" }, noSecret: true });
    const code1 = await codeWith(env);
    code1.setup();
    const st = env.state;
    const folderId = st.props.FOLDER_ID;
    const sheetId = st.props.DATA_SHEET_ID;
    const secret = st.props.HASH_SECRET;
    ok(folderId && sheetId && secret, "ids and secret saved");
    ok(secret.length >= 32, "long secret");
    eq(st.folders.length, 1);
    eq(st.folders[0].name, CONFIG.FOLDER_NAME);
    eq(st.folders[0].sharing, ["ANYONE_WITH_LINK", "VIEW"]);
    const ss = st.spreadsheets[sheetId];
    eq(ss.getName(), CONFIG.DATA_SHEET_NAME);
    eq(ss.getSheets().map((s) => s.getName()), ["Photos", "Hearts", "Devices"], "only our tabs");
    eq(ss.tab("Photos"), [["id", "at", "by", "deviceHash", "accountHash", "deleted"]]);
    eq(ss.tab("Hearts"), [["id", "deviceHash", "at"]]);
    eq(ss.tab("Devices"), [["deviceHash", "accountHash", "name", "linkedAt"]]);
    eq(st.triggers.map((t) => [t.fn, t.n]), [["syncDeletions", 15]]);
    ok(st.logs.some((l) => l.includes(st.folders[0].getUrl())), "folder link logged");
    ok(!st.logs.some((l) => l.includes(secret)), "secret never logged");

    ss.tab("Photos").push(["p1", 1, "", "h", "", false]);
    (await codeWith(env)).setup();
    eq([st.props.FOLDER_ID, st.props.DATA_SHEET_ID, st.props.HASH_SECRET], [folderId, sheetId, secret], "same ids and secret");
    eq(st.folders.length, 1, "no second folder");
    eq(Object.keys(st.spreadsheets).filter((id) => st.spreadsheets[id].getName() === CONFIG.DATA_SHEET_NAME).length, 1, "no second sheet");
    eq(ss.tab("Photos").length, 2, "data kept, header not repeated");
    eq(st.triggers.length, 1, "trigger replaced, not doubled");

    // Lost the saved ids (e.g. a new script project): reuse by name.
    delete st.props.FOLDER_ID;
    delete st.props.DATA_SHEET_ID;
    (await codeWith(env)).setup();
    eq([st.props.FOLDER_ID, st.props.DATA_SHEET_ID], [folderId, sheetId], "found again by name");
    eq(st.folders.length, 1);

    const r = await post(env, { action: "list", device: DEV_A, limit: 30 });
    eq([r.body.ok, r.body.total], [true, 1], "works after setup");
  });

  test("code.gs setup adopts only the owner's folder and sheet", async function () {
    const env = fakeGoogle({ props: { DATA_SHEET_ID: "" }, noSecret: true });
    const st = env.state;
    const strangerFolder = st.addFolder(CONFIG.FOLDER_NAME, "stranger@example.com");
    const sharedFolder = st.addFolder(CONFIG.FOLDER_NAME, null);
    const strangerSheet = st.addSheetFile(CONFIG.DATA_SHEET_NAME, "stranger@example.com");
    const sharedSheet = st.addSheetFile(CONFIG.DATA_SHEET_NAME, null);
    (await codeWith(env)).setup();
    ok([strangerFolder.id, sharedFolder.id].indexOf(st.props.FOLDER_ID) < 0, "someone else's folder not adopted");
    eq(st.folders.length, 3, "a new folder made");
    eq(strangerFolder.sharing, null, "someone else's folder left alone");
    ok([strangerSheet.getId(), sharedSheet.getId()].indexOf(st.props.DATA_SHEET_ID) < 0, "someone else's sheet not adopted");
    eq(strangerSheet.getSheets().map((s) => s.getName()), ["Sheet1"], "someone else's sheet left alone");

    const env2 = fakeGoogle({ props: { DATA_SHEET_ID: "" }, noSecret: true });
    const mineFolder = env2.state.addFolder(CONFIG.FOLDER_NAME, CONFIG.OWNER_EMAIL.toUpperCase());
    const mineSheet = env2.state.addSheetFile(CONFIG.DATA_SHEET_NAME, CONFIG.OWNER_EMAIL);
    (await codeWith(env2)).setup();
    eq([env2.state.props.FOLDER_ID, env2.state.props.DATA_SHEET_ID], [mineFolder.id, mineSheet.getId()],
      "the owner's own (email case ignored)");
    eq(env2.state.folders.length, 1);
  });

  test("code.gs DRIVE_FOLDER_ID accepts a folder link", async function () {
    const saved = CONFIG.DRIVE_FOLDER_ID;
    try {
      const env = fakeGoogle({ props: { DATA_SHEET_ID: "" }, noSecret: true });
      const f = env.state.addFolder("Chosen");
      CONFIG.DRIVE_FOLDER_ID = "https://drive.google.com/drive/folders/" + f.id + "?usp=sharing";
      (await codeWith(env)).setup();
      eq(env.state.props.FOLDER_ID, f.id, "setup uses the id inside the link");

      CONFIG.DRIVE_FOLDER_ID = "https://example.com/nope";
      let msg = "";
      try { (await codeWith(fakeGoogle({ props: { DATA_SHEET_ID: "" }, noSecret: true }))).setup(); } catch (e) { msg = String(e); }
      ok(/DRIVE_FOLDER_ID/.test(msg), "an unrecognised value is an error, not ignored: " + msg);
    } finally {
      CONFIG.DRIVE_FOLDER_ID = saved;
    }
  });

  test("code.gs setup with a bad SYNC_MINUTES", async function () {
    const saved = CONFIG.SYNC_MINUTES;
    CONFIG.SYNC_MINUTES = 7;
    try {
      const env = fakeGoogle({ props: { DATA_SHEET_ID: "" } });
      (await codeWith(env)).setup();
      eq(env.state.triggers.map((t) => t.n), [15]);
      ok(env.state.logs.some((l) => /SYNC_MINUTES/.test(l)), "logs the fallback");
    } finally {
      CONFIG.SYNC_MINUTES = saved;
    }
  });

  /* ---------- delete and the Drive sync ---------- */

  // A photos folder holding files `ids`, Photos rows for them owned by device A.
  async function deleteEnv(ids, o) {
    const base = fakeGoogle();
    const hA = await hashOf(base, DEV_A);
    const rows = ids.map((id, i) => [id, 1000 + i, "", hA, "", false]);
    const env = fakeGoogle(Object.assign({ folder: true, photos: rows }, o || {}));
    ids.forEach((id) => env.state.folders[0].addFile(id));
    return { env, hA, rows: () => env.state.spreadsheets.data1.tab("Photos"), file: (id) => env.state.folders[0].files.find((f) => f.id === id) };
  }

  test("code.gs delete own photo", async function () {
    const d = await deleteEnv(["f1", "f2"]);
    await post(d.env, { action: "list", device: DEV_A, limit: 30 });   // fills the list cache
    d.env.state.events.length = 0;
    const r = (await post(d.env, { action: "delete", device: DEV_A, id: "f1" })).body;
    eq(r, { ok: true });
    eq(d.file("f1").trashed, true, "file in the Drive trash (recoverable)");
    eq(d.file("f2").trashed, false);
    eq(d.rows()[1], ["f1", 1000, "", d.hA, "", true], "row marked deleted, not removed");
    eq(d.env.state.events, ["trash f1", "lock", "flush", "remove rows:Photos:n", "release"],
      "Drive call outside the lock; row written and cache dropped under it");
    const list = (await post(d.env, { action: "list", device: DEV_B, limit: 30 })).body;
    eq(list.photos.map((p) => p.id), ["f2"], "gone for everyone");
    d.env.state.events.length = 0;
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f1" })).body, { ok: true }, "again: fine");
    eq(d.env.state.events, [], "nothing done twice");
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "never" })).body, { ok: true }, "unknown id");
    eq((await post(d.env, { action: "heart", device: DEV_B, id: "f1", on: true })).body, { ok: false, code: "invalid" });
  });

  test("code.gs delete refuses other phones", async function () {
    const d = await deleteEnv(["f1"]);
    eq((await post(d.env, { action: "delete", device: DEV_B, id: "f1" })).body, { ok: false, code: "forbidden" });
    eq(d.file("f1").trashed, false);
    eq(d.rows()[1][5], false);
    eq((await post(d.env, { action: "delete", device: DEV_A })).body, { ok: false, code: "invalid" }, "id missing");
    eq((await post(d.env, { action: "delete", device: DEV_A, id: 7 })).body, { ok: false, code: "invalid" });
  });

  test("code.gs delete from a phone linked to the same account", async function () {
    const base = fakeGoogle();
    const hA = await hashOf(base, DEV_A);
    const hB = await hashOf(base, DEV_B);
    const env = fakeGoogle({ folder: true, photos: [["f1", 1, "", hA, "acc", false]], devices: [[hB, "acc", "Ravi", 5]] });
    env.state.folders[0].addFile("f1");
    eq((await post(env, { action: "delete", device: DEV_B, id: "f1" })).body, { ok: true });
    eq(env.state.spreadsheets.data1.tab("Photos")[1][5], true);
  });

  test("code.gs delete when Drive no longer has the file", async function () {
    const d = await deleteEnv(["f1"]);
    d.env.state.folders[0].files.length = 0;   // the owner already removed it in Drive
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f1" })).body, { ok: true });
    eq(d.rows()[1][5], true, "row marked anyway");
  });

  test("code.gs delete Drive errors", async function () {
    let d = await deleteEnv(["f1"], { trashError: "Service unavailable" });
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f1" })).body, { ok: false, code: "unavailable" });
    eq(d.rows()[1][5], false, "photo stays");
    ok(!d.env.state.events.includes("lock"), "no lock taken");
    d = await deleteEnv(["f1"], { trashError: "User rate limit exceeded." });
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f1" })).body, { ok: false, code: "busy" });
    d = await deleteEnv(["f1"], { lockBusy: true });
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f1" })).body, { ok: false, code: "busy" });
    eq(d.rows()[1][5], false, "lock busy: row not written (the site tries again; the sync also catches it)");
  });

  test("code.gs delete finds a photo the cache doesn't know yet", async function () {
    const d = await deleteEnv(["f1"]);
    await post(d.env, { action: "list", device: DEV_A, limit: 30 });   // cache: f1 only
    d.rows().push(["f2", 2000, "", d.hA, "", false]);                   // added after, cache not dropped
    d.env.state.folders[0].addFile("f2");
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f2" })).body, { ok: true });
    eq(d.file("f2").trashed, true);
    eq(d.rows()[2][5], true);
  });

  test("code.gs syncDeletions marks photos removed in Drive", async function () {
    const d = await deleteEnv(["keep", "gone", "trashed"]);
    d.rows().push(["young", Date.now(), "", d.hA, "", false]);   // just uploaded: its file may not be listed yet
    d.env.state.folders[0].files.splice(1, 1);                  // "gone" deleted for good
    d.file("trashed").trashed = true;                           // moved to the trash in Drive
    await post(d.env, { action: "list", device: DEV_A, limit: 30 });   // fills the list cache
    d.env.state.events.length = 0;
    (await codeWith(d.env)).syncDeletions();
    eq(d.rows().slice(1).map((r) => [r[0], r[5]]), [["keep", false], ["gone", "sync"], ["trashed", "sync"], ["young", false]],
      "hidden by the sync (undone if the file comes back)");
    eq(d.env.state.events, ["search trashed = false", "lock", "flush", "remove rows:Photos:n", "release"],
      "Drive listed outside the lock; rows written and cache dropped under it");
    const list = (await post(d.env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq(list.photos.map((p) => p.id), ["young", "keep"]);
    d.env.state.events.length = 0;
    (await codeWith(d.env)).syncDeletions();
    eq(d.env.state.events.filter((e) => e === "flush" || e === "lock"), [], "nothing to change: no lock taken");
  });

  test("code.gs syncDeletions never throws and never guesses", async function () {
    const untouched = (d) => d.rows().slice(1).every((r) => r[5] === false);
    const cases = [
      ["folder unreachable", (env) => { env.state.props.FOLDER_ID = "nope"; }],
      ["Drive search fails", null, { searchError: "Service unavailable" }],
      ["Drive fails while listing", null, { searchFailsAt: 1 }],
      ["lock busy", (env) => { env.state.folders[0].files.splice(0, 1); }, { lockBusy: true }],
      ["not set up", (env) => { delete env.state.props.HASH_SECRET; env.state.folders[0].files.splice(0, 1); }],
    ];
    for (const [what, change, o] of cases) {
      const d = await deleteEnv(["f1", "f2", "f3"], o);
      if (change) change(d.env);
      const code = await codeWith(d.env);
      let threw = null;
      try { code.syncDeletions(); } catch (e) { threw = e; }
      eq(threw, null, what + ": threw");
      ok(untouched(d), what + ": rows changed");
      ok(d.env.state.logs.concat(d.env.state.errors).some((l) => /sync/i.test(l)), what + ": logged");
    }
  });

  test("code.gs syncDeletions: every file trashed hides every photo", async function () {
    // The pre-launch cleanup: the owner trashes all beta photos in the folder.
    const d = await deleteEnv(["f1", "f2", "f3"]);
    d.env.state.folders[0].files.forEach((f) => { f.trashed = true; });
    (await codeWith(d.env)).syncDeletions();
    eq(d.rows().slice(1).map((r) => r[5]), ["sync", "sync", "sync"]);
    const list = (await post(d.env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq([list.photos.length, list.total], [0, 0], "launch shows an empty album");
    eq((await post(d.env, { action: "heart", device: DEV_B, id: "f1", on: true })).body, { ok: false, code: "invalid" },
      "no hearts on a hidden photo");
    eq((await post(d.env, { action: "list", device: DEV_A, limit: 30, mine: true })).body.total, 0, "not in Photos by me");
  });

  test("code.gs syncDeletions brings back a photo whose file is back", async function () {
    const d = await deleteEnv(["f1", "f2"]);
    d.file("f1").trashed = true;
    (await codeWith(d.env)).syncDeletions();
    eq(d.rows()[1][5], "sync");
    d.file("f1").trashed = false;                       // restored from the trash (or a bad listing before)
    await post(d.env, { action: "list", device: DEV_A, limit: 30 });   // fills the list cache
    d.env.state.events.length = 0;
    (await codeWith(d.env)).syncDeletions();
    eq(d.rows().slice(1).map((r) => r[5]), [false, false]);
    ok(d.env.state.events.includes("remove rows:Photos:n"), "cache dropped");
    const list = (await post(d.env, { action: "list", device: DEV_B, limit: 30 })).body;
    eq(list.photos.map((p) => p.id).sort(), ["f1", "f2"]);
  });

  test("code.gs deleted in the app stays deleted", async function () {
    const d = await deleteEnv(["f1", "f2"]);
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f1" })).body, { ok: true });
    d.rows().push(["owner", 1, "", "h", "", true]);       // the owner's own TRUE in the sheet
    d.env.state.folders[0].addFile("owner");
    d.file("f1").trashed = false;                       // the owner restores the file in Drive
    (await codeWith(d.env)).syncDeletions();
    eq(d.rows().slice(1).map((r) => [r[0], r[5]]), [["f1", true], ["f2", false], ["owner", true]]);
    // Deleting a photo the sync hid (a stale screen) makes it permanent.
    d.file("f2").trashed = true;
    (await codeWith(d.env)).syncDeletions();
    eq(d.rows()[2][5], "sync");
    eq((await post(d.env, { action: "delete", device: DEV_B, id: "f2" })).body, { ok: false, code: "forbidden" });
    eq((await post(d.env, { action: "delete", device: DEV_A, id: "f2" })).body, { ok: true });
    eq(d.rows()[2][5], true);
    d.file("f2").trashed = false;
    (await codeWith(d.env)).syncDeletions();
    eq(d.rows()[2][5], true, "not brought back");
  });

  test("code.gs syncDeletions gives up when Drive is too slow", async function () {
    const saved = CONFIG.SYNC_MAX_SECONDS;
    CONFIG.SYNC_MAX_SECONDS = 0;
    try {
      const d = await deleteEnv(["f1", "f2", "f3"]);
      d.env.state.folders[0].files.splice(0, 1);
      (await codeWith(d.env)).syncDeletions();
      ok(d.rows().slice(1).every((r) => r[5] === false), "a part of the list is never used");
      ok(d.env.state.logs.some((l) => /SYNC_MAX_SECONDS/.test(l)), "logged");
    } finally {
      CONFIG.SYNC_MAX_SECONDS = saved;
    }
  });

  /* ---------- upload ---------- */

  // Base64 of `n` bytes starting with `head` (default: the JPEG start bytes).
  function b64(n, head) {
    head = head || [0xFF, 0xD8, 0xFF, 0xE0];
    const bytes = new Uint8Array(n);
    head.forEach((b, i) => { bytes[i] = b; });
    for (let i = head.length; i < n; i++) bytes[i] = (i * 7) & 255;
    let bin = "";
    for (let i = 0; i < n; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const PNG_HEAD = [0x89, 0x50, 0x4E, 0x47];

  function uploadReq(extra) {
    return Object.assign({ action: "upload", device: DEV_A, name: "Ravi", mime: "image/jpeg", data: b64(64) }, extra || {});
  }

  // Calendar date in the backend's time zone, as Code.gs writes it.
  function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.TIME_ZONE }).format(new Date());
  }

  function uploadEnv(o) {
    return fakeGoogle(Object.assign({ folder: true }, o || {}));
  }

  test("code.gs upload saves the photo", async function () {
    const env = uploadEnv();
    const hA = await hashOf(env, DEV_A);
    await post(env, { action: "list", device: DEV_A, limit: 30 });   // fills the list cache
    env.state.events.length = 0;
    const data = b64(5000);
    const before = Date.now();
    const r = (await post(env, uploadReq({ name: "  Ravi \n uncle\u0007 ", data }))).body;
    const folder = env.state.folders[0];
    eq(folder.files.length, 1, "one file in the photos folder");
    const file = folder.files[0];
    eq(Object.keys(r), ["ok", "photo"]);
    eq(Object.keys(r.photo), ["id", "by", "at", "hearts", "hearted", "mine"], "contract Photo shape");
    eq(r.photo, { id: file.id, by: "Ravi uncle", at: r.photo.at, hearts: 0, hearted: false, mine: true });
    ok(r.photo.at >= before && r.photo.at <= Date.now(), "at = now");
    ok(new RegExp("^" + today().replace(/-/g, "") + "-\\d{6}-[0-9a-f]{6}\\.jpg$").test(file.name), "file name " + file.name);
    eq(file.mime, "image/jpeg");
    eq(btoa(String.fromCharCode(...Array.from(file.bytes, (b) => b & 255))), data, "bytes kept");
    eq(env.state.spreadsheets.data1.tab("Photos")[1], [file.id, r.photo.at, "Ravi uncle", hA, "", false]);
    eq(env.state.events, ["createFile", "lock", "flush", "remove rows:Photos:n", "release"],
      "file made before the lock; only the row under it; cache dropped before unlock");
    const list = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq(list.photos, [r.photo], "list shows it at once");
    const other = (await post(env, { action: "list", device: DEV_B, limit: 30 })).body;
    eq(other.photos[0].mine, false, "not another phone's");
  });

  test("code.gs upload names", async function () {
    let env = uploadEnv();
    let r = (await post(env, uploadReq({ name: "=HYPERLINK(\"x\")" }))).body;
    eq(env.state.spreadsheets.data1.tab("Photos")[1][2], "'=HYPERLINK(\"x\")", "stored unable to become a formula");
    eq(r.photo.by, "=HYPERLINK(\"x\")");
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.photos[0].by, "=HYPERLINK(\"x\")",
      "the guard never shows");
    r = (await post(env, uploadReq({ name: "a".repeat(300) }))).body;
    eq(r.photo.by, "a".repeat(CONFIG.NAME_MAX_LENGTH));
    r = (await post(env, uploadReq({ name: undefined }))).body;
    eq(r.photo.by, "", "no name = anonymous");
    r = (await post(env, uploadReq({ name: { x: 1 } }))).body;
    eq(r.photo.by, "", "a name that is not text = anonymous");

    // A phone linked to a Google account shares under the account's name.
    const hA = await hashOf(env, DEV_A);
    env = uploadEnv({ devices: [[hA, "acc1", "Ravi Kumar", 5]] });
    r = (await post(env, uploadReq({ name: "typed name" }))).body;
    eq([r.ok, r.photo.by, r.photo.mine], [true, "Ravi Kumar", true]);
    const row = env.state.spreadsheets.data1.tab("Photos")[1];
    eq([row[2], row[3], row[4]], ["Ravi Kumar", hA, "acc1"], "account recorded");
  });

  test("code.gs upload checks in order", async function () {
    const saved = CONFIG.MAX_PHOTO_BYTES;
    CONFIG.MAX_PHOTO_BYTES = 100;
    try {
      const hA = await hashOf(fakeGoogle(), DEV_A);
      const recent = Array.from({ length: CONFIG.RATE_LIMIT_PER_HOUR }, (_, i) =>
        ["r" + i, Date.now() - 60000, "", hA, "", i % 2 === 0]);
      const cases = [
        ["paused before anything", { settings: [["gallery_uploads", "no"]], used: 99, photos: recent }, { mime: "x" }, "paused"],
        ["full before checking the photo", { used: 98, photos: recent }, { mime: "x" }, "full"],
        ["wrong mime", {}, { mime: "image/png" }, "invalid"],
        ["no data", {}, { data: undefined }, "invalid"],
        ["empty data", {}, { data: "" }, "invalid"],
        ["data not text", {}, { data: 42 }, "invalid"],
        ["malformed base64", {}, { data: "@@not base64@@" }, "invalid"],
        ["too large before the jpeg check", { photos: recent }, { data: b64(101, PNG_HEAD) }, "too_large"],
        ["not a jpeg", { photos: recent }, { data: b64(64, PNG_HEAD) }, "invalid"],
        ["rate limited (deleted ones count)", { photos: recent }, {}, "rate_limited"],
      ];
      for (const [what, opts, extra, code] of cases) {
        const env = uploadEnv(opts);
        eq((await post(env, uploadReq(extra))).body, { ok: false, code }, what);
        eq(env.state.folders[0].files.length, 0, what + ": no file");
        eq(env.state.spreadsheets.data1.tab("Photos").length, 1 + (opts.photos || []).length, what + ": no row");
        eq(env.state.events.filter((e) => e === "createFile" || e === "flush"), [], what + ": no Drive or sheet write");
        eq(env.state.mails.length, code === "full" ? 1 : 0, what + ": owner told only when full");
      }
      const env = uploadEnv();
      eq((await post(env, uploadReq({ data: b64(100) }))).body.ok, true, "exactly the limit is fine");
      const old = recent.map((r) => [r[0], Date.now() - 2 * 3600000].concat(r.slice(2)));
      const another = recent.map((r) => [r[0], r[1], r[2], "hOther", r[4], r[5]]);
      eq((await post(uploadEnv({ photos: old }), uploadReq())).body.ok, true, "older than an hour don't count");
      eq((await post(uploadEnv({ photos: another }), uploadReq())).body.ok, true, "other phones don't count");
      eq((await post(uploadEnv({ photos: recent.slice(1) }), uploadReq())).body.ok, true, "one below the limit");
    } finally {
      CONFIG.MAX_PHOTO_BYTES = saved;
    }
  });

  test("code.gs upload when Drive is full", async function () {
    let env = uploadEnv({ createFileError: "Exception: The user's Drive storage quota has been exceeded." });
    eq((await post(env, uploadReq())).body, { ok: false, code: "full" });
    eq(env.state.spreadsheets.data1.tab("Photos").length, 1, "no row");
    eq(env.state.lock.held, false);
    eq(env.state.mails.length, 1, "owner told");
    ok(env.state.mails[0].subject.indexOf("100") >= 0, "as 100% full: " + env.state.mails[0].subject);
    ok(!/[{}]/.test(env.state.mails[0].body), "body filled in");
    const list = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
    eq(list.full, true, "lists say full for a while");
    eq((await post(env, uploadReq())).body, { ok: false, code: "full" }, "next upload stops early");
    eq(env.state.events.filter((e) => e === "createFile").length, 1, "without trying Drive again");
    eq(env.state.mails.length, 1, "still one email that day");

    // Drive can't say its size, then says full: the email still goes, without numbers.
    env = uploadEnv({ createFileError: "Storage quota exceeded" });
    env.DriveApp.getStorageUsed = () => { throw new Error("Drive hiccup"); };
    eq((await post(env, uploadReq())).body, { ok: false, code: "full" });
    eq(env.state.mails.length, 1);
    ok(env.state.mails[0].body.indexOf("100% full (? GB of ? GB used)") >= 0, env.state.mails[0].body.slice(0, 80));
  });

  test("code.gs upload Drive rate limits are busy, not full", async function () {
    for (const msg of ["Limit Exceeded: DriveApp.", "User rate limit exceeded.",
      "Service invoked too many times for one day: driveapp."]) {
      const env = uploadEnv({ createFileError: msg });
      eq((await post(env, uploadReq())).body, { ok: false, code: "busy" }, msg);
      eq(env.state.spreadsheets.data1.tab("Photos").length, 1, msg + ": no row");
      eq(env.state.mails.length, 0, msg + ": no email");
      eq(env.state.errors, [], msg + ": not an error");
      eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.full, false, msg + ": not remembered as full");
      eq((await post(env, uploadReq())).body.code, "busy", msg + ": the next upload asks Drive again");
      eq(env.state.events.filter((e) => e === "createFile").length, 2);
    }
  });

  test("code.gs upload Drive errors", async function () {
    let env = uploadEnv({ createFileError: "Service unavailable" });
    eq((await post(env, uploadReq())).body, { ok: false, code: "unavailable" });
    ok(env.state.errors.some((e) => /Service unavailable/.test(e)), "logged");
    eq(env.state.lock.held, false);
    eq((await post(env, { action: "list", device: DEV_A, limit: 30 })).body.full, false, "not marked full");

    env = uploadEnv();
    env.state.spreadsheets.data1.getSheetByName("Photos").appendRow = () => { throw new Error("Sheets hiccup"); };
    eq((await post(env, uploadReq())).body, { ok: false, code: "unavailable" });
    eq(env.state.folders[0].files.map((f) => f.trashed), [true], "the file without a row goes to the trash");
    eq(env.state.lock.held, false);

    env = uploadEnv({ lockBusy: true });
    eq((await post(env, uploadReq())).body, { ok: false, code: "busy" });
    eq(env.state.folders[0].files.map((f) => f.trashed), [true], "lock busy: the file without a row goes to the trash");
    eq(env.state.spreadsheets.data1.tab("Photos").length, 1, "no row");

    env = fakeGoogle();   // setup() never made the folder
    eq((await post(env, uploadReq())).body, { ok: false, code: "unavailable" });
    ok(env.state.errors.some((e) => /setup\(\)/.test(e)), "logs: run setup()");
  });

  test("code.gs storage warning email at most once a day", async function () {
    let env = uploadEnv({ used: 90, limit: 100 });
    eq((await post(env, uploadReq())).body.ok, true, "warn level still uploads");
    eq(env.state.mails.length, 1);
    const mail = env.state.mails[0];
    eq(mail.to, CONFIG.OWNER_EMAIL);
    ok(mail.subject.indexOf("90") >= 0 && !/[{}]/.test(mail.subject), "subject: " + mail.subject);
    ok(mail.body.indexOf("90") >= 0 && !/[{}]/.test(mail.body), "body filled in");
    eq(env.state.props.lastWarnDate, today());
    eq((await post(env, uploadReq())).body.ok, true);
    eq(env.state.mails.length, 1, "not again the same day");
    env.state.props.lastWarnDate = "2000-01-01";
    await post(env, uploadReq());
    eq(env.state.mails.length, 2, "again on another day");

    env = uploadEnv({ used: 84, limit: 100 });
    await post(env, uploadReq());
    eq(env.state.mails.length, 0, "below the warning level");

    env = uploadEnv({ used: 90, limit: 100, mailError: "Service invoked too many times: email" });
    eq((await post(env, uploadReq())).body.ok, true, "a failed email never blocks the upload");
    ok(env.state.logs.some((l) => /too many times/.test(l)), "mail error logged");

    env = uploadEnv({ used: 90, limit: 100, lockBusy: true });
    eq((await post(env, uploadReq())).body, { ok: false, code: "busy" });
    eq(env.state.mails.length, 0, "no email while another change holds the lock (a later upload sends it)");

    // At the stop level the owner is told too, still once a day.
    env = uploadEnv({ used: 99, limit: 100 });
    eq((await post(env, uploadReq())).body, { ok: false, code: "full" });
    eq(env.state.mails.length, 1, "told at the stop level");
    ok(env.state.mails[0].subject.indexOf("99") >= 0, env.state.mails[0].subject);
    eq((await post(env, uploadReq())).body, { ok: false, code: "full" });
    eq(env.state.mails.length, 1, "not again the same day");
    env = uploadEnv({ used: 99, limit: 100, props: { lastWarnDate: today() } });
    await post(env, uploadReq());
    eq(env.state.mails.length, 0, "the warning-level email already sent today counts");
  });

  /* ---------- Google sign-in: link / unlink ---------- */

  const TOKEN = "eyJ.token+/=.sig";
  const SUB = "sub-1098765";

  // tokeninfo answers: the token TOKEN is good (for client "cid"); `over` changes its fields.
  function tokeninfoFor(over) {
    return (token) => {
      if (token !== TOKEN) return { code: 400, body: "{\"error\":\"invalid_token\"}" };
      const info = Object.assign({ aud: "cid", iss: "https://accounts.google.com", sub: SUB,
        exp: String(Math.floor(Date.now() / 1000) + 3000), name: "  Ravi\n Kumar ", email: "ravi@example.com",
        email_verified: "true" }, over || {});
      return { code: 200, body: JSON.stringify(info) };
    };
  }

  // Runs fn with CONFIG.GOOGLE_CLIENT_ID = id, put back afterwards.
  async function withClientId(id, fn) {
    const saved = CONFIG.GOOGLE_CLIENT_ID;
    CONFIG.GOOGLE_CLIENT_ID = id;
    try {
      return await fn();
    } finally {
      CONFIG.GOOGLE_CLIENT_ID = saved;
    }
  }

  function tokenSaid(env) {
    const said = env.state.logs.concat(env.state.errors).join("\n");
    return said.indexOf(TOKEN) >= 0 || said.indexOf(encodeURIComponent(TOKEN)) >= 0;
  }

  test("code.gs link verifies the token and claims this phone's photos", async function () {
    await withClientId("cid", async () => {
      const base = fakeGoogle();
      const hA = await hashOf(base, DEV_A);
      const hB = await hashOf(base, DEV_B);
      const acc = await hashOf(base, "g:" + SUB);
      const env = fakeGoogle({ tokeninfo: tokeninfoFor(), photos: [
        ["a1", 10, "", hA, "", false],
        ["a2", 20, "", hA, "older-acc", false],
        ["b1", 30, "", hB, "", false],
        ["a3", 40, "", hA, "", true],
      ] });
      await post(env, { action: "list", device: DEV_A, limit: 30 });   // fills the list cache
      env.state.events.length = 0;
      const r = (await post(env, { action: "link", device: DEV_A, idToken: TOKEN })).body;
      eq(r, { ok: true, account: { name: "Ravi Kumar" }, linked: 1 }, "linked counts photos still shown");
      eq(env.state.fetches.length, 1, "asked Google once");
      // The token goes in a POST form body, never in the address (addresses end up in logs).
      eq(env.state.fetches[0].url, "https://oauth2.googleapis.com/tokeninfo");
      eq(env.state.fetches[0].opts, { method: "post", payload: { id_token: TOKEN }, muteHttpExceptions: true });
      eq(env.state.events.filter((e) => e === "lock").length, 1, "one lock");
      ok(env.state.events.indexOf("fetch") >= 0 && env.state.events.indexOf("fetch") < env.state.events.indexOf("lock"),
        "Google asked outside the lock: " + env.state.events.join(", "));
      const devices = env.state.spreadsheets.data1.tab("Devices");
      eq(devices.length, 2, "one Devices row");
      eq(devices[1].slice(0, 3), [hA, acc, "Ravi Kumar"]);
      ok(Math.abs(devices[1][3] - Date.now()) < 5000, "linkedAt = now");
      const photos = env.state.spreadsheets.data1.tab("Photos");
      eq(photos.slice(1).map((p) => p[4]), [acc, "older-acc", "", acc], "this phone's unclaimed photos only");
      const stored = JSON.stringify(env.state.spreadsheets) + JSON.stringify([...env.state.cache.values()]);
      ok(stored.indexOf("ravi@example.com") < 0, "email never stored");
      ok(stored.indexOf(SUB) < 0, "raw account id never stored");
      ok(stored.indexOf(TOKEN) < 0 && stored.indexOf(encodeURIComponent(TOKEN)) < 0, "token never stored");
      ok(!tokenSaid(env), "token never logged");
      const list = (await post(env, { action: "list", device: DEV_A, limit: 30 })).body;
      eq(list.account, { name: "Ravi Kumar" }, "list says who is signed in");
    });
  });

  test("code.gs link refuses tokens it can't verify", async function () {
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      ["wrong audience", tokeninfoFor({ aud: "someone-else" })],
      ["wrong issuer", tokeninfoFor({ iss: "https://evil.example" })],
      ["expired", tokeninfoFor({ exp: String(now - 10) })],
      ["no account id", tokeninfoFor({ sub: "" })],
      ["Google says no", () => ({ code: 400, body: "{\"error\":\"invalid_token\"}" })],
      ["Google error page", () => ({ code: 500, body: "<html>oops</html>" })],
      ["not JSON", () => ({ code: 200, body: "<html>sign in</html>" })],
      ["JSON but not an object", () => ({ code: 200, body: "\"cid\"" })],
      ["fetch fails", (t) => { throw new Error("Address unavailable: https://oauth2.googleapis.com/tokeninfo (" + t + ")"); }],
    ];
    await withClientId("cid", async () => {
      for (const [what, tokeninfo] of cases) {
        const env = fakeGoogle({ tokeninfo });
        const r = (await post(env, { action: "link", device: DEV_A, idToken: TOKEN })).body;
        eq(r, { ok: false, code: "signin_failed" }, what);
        eq(env.state.spreadsheets.data1.tab("Devices").length, 1, what + ": nothing written");
        ok(!env.state.events.includes("lock"), what + ": no lock taken");
        ok(!tokenSaid(env), what + ": token never logged");
      }
    });
    // Sign-in switched off on the server: refused without asking Google.
    await withClientId("", async () => {
      const env = fakeGoogle({ tokeninfo: tokeninfoFor({ aud: "" }) });
      eq((await post(env, { action: "link", device: DEV_A, idToken: TOKEN })).body, { ok: false, code: "signin_failed" });
      eq(env.state.fetches.length, 0, "Google not asked");
      eq(env.state.spreadsheets.data1.tab("Devices").length, 1);
    });
  });

  test("code.gs linked phones act as the account", async function () {
    await withClientId("cid", async () => {
      const base = fakeGoogle();
      const hA = await hashOf(base, DEV_A);
      const env = fakeGoogle({ folder: true, tokeninfo: tokeninfoFor(), photos: [["f1", 10, "", hA, "", false]] });
      env.state.folders[0].addFile("f1");
      eq((await post(env, { action: "list", device: DEV_B, limit: 30, mine: true })).body.photos, [], "B: nothing yet");
      eq((await post(env, { action: "delete", device: DEV_B, id: "f1" })).body, { ok: false, code: "forbidden" });
      eq((await post(env, { action: "link", device: DEV_A, idToken: TOKEN })).body.linked, 1);
      eq((await post(env, { action: "link", device: DEV_B, idToken: TOKEN })).body, { ok: true, account: { name: "Ravi Kumar" }, linked: 0 });
      const mine = (await post(env, { action: "list", device: DEV_B, limit: 30, mine: true })).body;
      eq(mine.photos.map((p) => [p.id, p.mine]), [["f1", true]], "A's photo is B's too");
      eq(mine.account, { name: "Ravi Kumar" });
      const up = (await post(env, uploadReq({ device: DEV_B, name: "typed" }))).body;
      eq(up.photo.by, "Ravi Kumar", "shared under the Google name");
      eq((await post(env, { action: "delete", device: DEV_B, id: "f1" })).body, { ok: true }, "B may delete A's photo");
    });
  });

  test("code.gs link again updates, unlink clears", async function () {
    await withClientId("cid", async () => {
      const base = fakeGoogle();
      const hA = await hashOf(base, DEV_A);
      const acc = await hashOf(base, "g:" + SUB);
      let info = tokeninfoFor();
      const env = fakeGoogle({ tokeninfo: (t) => info(t), photos: [["a1", 10, "", hA, "", false]] });
      await post(env, { action: "link", device: DEV_A, idToken: TOKEN });
      info = tokeninfoFor({ name: "Ravi K" });
      eq((await post(env, { action: "link", device: DEV_A, idToken: TOKEN })).body, { ok: true, account: { name: "Ravi K" }, linked: 0 });
      const devices = () => env.state.spreadsheets.data1.tab("Devices");
      eq(devices().length, 2, "still one row for the phone");
      eq(devices()[1].slice(0, 3), [hA, acc, "Ravi K"]);
      env.state.events.length = 0;
      eq((await post(env, { action: "unlink", device: DEV_A })).body, { ok: true });
      ok(env.state.events.includes("lock"), "written under the lock");
      eq(devices()[1].slice(0, 3), [hA, "", ""], "account and name cleared");
      const list = (await post(env, { action: "list", device: DEV_A, limit: 30, mine: true })).body;
      eq(list.account, null);
      eq(list.photos.map((p) => p.id), ["a1"], "still this phone's photo");
      eq(env.state.spreadsheets.data1.tab("Photos")[1][4], acc, "the photo keeps its account");
      eq((await post(env, { action: "unlink", device: DEV_A })).body, { ok: true }, "again: fine");
      eq((await post(env, { action: "unlink", device: DEV_B })).body, { ok: true }, "never linked: fine");
      eq(devices().length, 2, "unlink adds no rows");
    });
  });

  /* ---------- the stand-in (tools/mock_gallery.py) answers uploads like Code.gs ---------- */

  async function standIn(mode, req) {
    const res = await fetch("/mock-api?mode=" + mode, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(req),
    });
    return res.json();
  }

  test("stand-in upload codes and order match code.gs", async function () {
    // Only failing uploads here: a stored one would join that mode's album for other tests.
    const big = b64(CONFIG.MAX_PHOTO_BYTES + 1, PNG_HEAD);   // the stand-in mirrors MAX_PHOTO_BYTES
    const cases = [
      ["paused", { mime: "x" }, "paused"],
      ["full", { mime: "x" }, "full"],
      ["ratelimit", { mime: "image/png" }, "invalid"],
      ["ratelimit", { data: undefined }, "invalid"],
      ["ratelimit", { data: 42 }, "invalid"],
      ["ratelimit", { data: "@@not base64@@" }, "invalid"],
      ["ratelimit", { data: big }, "too_large"],
      ["ratelimit", { data: b64(64, PNG_HEAD) }, "invalid"],
      ["ratelimit", {}, "rate_limited"],
    ];
    for (const [mode, extra, code] of cases) {
      const req = uploadReq(extra);
      eq(await standIn(mode, req), { ok: false, code }, mode + " " + JSON.stringify(extra).slice(0, 40));
    }
  });

  test("stand-in link and unlink like code.gs", async function () {
    // Its own mode name, so this upload joins no other test's album.
    const mode = "linktest";
    const dx = "d".repeat(31) + "1";
    const dy = "d".repeat(31) + "2";
    eq(await standIn(mode, { action: "link", device: dx }), { ok: false, code: "invalid" }, "no token");
    eq(await standIn(mode, { action: "link", device: dx, idToken: "real-looking.jwt.token" }), { ok: false, code: "signin_failed" });
    eq(await standIn(mode, { action: "link", device: dx, idToken: "mock:" }), { ok: false, code: "signin_failed" }, "no name");
    const up = await standIn(mode, uploadReq({ device: dx, name: "typed" }));
    eq([up.ok, up.photo.by, up.photo.mine], [true, "typed", true]);
    eq(await standIn(mode, { action: "link", device: dx, idToken: "mock:Asha  Rao" }), { ok: true, account: { name: "Asha Rao" }, linked: 1 });
    eq(await standIn(mode, { action: "link", device: dy, idToken: "mock:Asha  Rao" }), { ok: true, account: { name: "Asha Rao" }, linked: 0 });
    let mine = await standIn(mode, { action: "list", device: dy, limit: 30, mine: true });
    eq(mine.photos.map((p) => [p.id, p.mine]), [[up.photo.id, true]], "same account, other phone");
    eq(mine.account, { name: "Asha Rao" });
    const up2 = await standIn(mode, uploadReq({ device: dy, name: "typed" }));
    eq(up2.photo.by, "Asha Rao", "shared under the account name");
    eq(await standIn(mode, { action: "unlink", device: dy }), { ok: true });
    mine = await standIn(mode, { action: "list", device: dy, limit: 30, mine: true });
    eq(mine.photos.map((p) => p.id), [up2.photo.id], "only this phone's own photo");
    eq(mine.account, null);
    eq(await standIn(mode, { action: "delete", device: dy, id: up.photo.id }), { ok: false, code: "forbidden" });
    eq(await standIn(mode, { action: "delete", device: dx, id: up2.photo.id }), { ok: true }, "the account's photo, from x");
    eq(await standIn(mode, { action: "delete", device: dx, id: up.photo.id }), { ok: true });
    eq(await standIn(mode, { action: "unlink", device: dx }), { ok: true });
  });
})();
