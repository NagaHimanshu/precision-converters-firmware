// Tests for gallery/view-grid.js and gallery/view-viewer.js. Most render into a
// root of this page with a fake store; the last one drives the real site in an iframe.
(function () {
  "use strict";

  var G = function () { return self.WeddingGallery; };
  var T = function () { return self.SITE_CONFIG.text.gallery; };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ms: how long to wait (default 3.5 s; the real-site tests below wait longer for page loads).
  function waitFor(fn, what, ms) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function poll() {
        var v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start > (ms || 3500)) return reject(new Error("timed out waiting for " + what));
        setTimeout(poll, 50);
      })();
    });
  }

  // Same small helpers app.js hands the gallery.
  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }
  function h(tag, props) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") node.className = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    [].slice.call(arguments, 2).flat().forEach(function (kid) {
      if (kid == null || kid === false || kid === "") return;
      node.append(kid instanceof Node ? kid : String(kid));
    });
    return node;
  }
  function icon() { return document.createElementNS("http://www.w3.org/2000/svg", "svg"); }

  function ctx() {
    var C = self.SITE_CONFIG;
    return { cfg: C, text: C.text.gallery, h: h, icon: icon, fill: fill,
      storageGet: function () { return null; }, storageSet: function () {},
      uploadsOpen: true, goContacts: function () {}, locale: C.locale };
  }

  function photo(id, over) {
    return Object.assign({ id: id, by: "", at: Date.now(), hearts: 0, hearted: false, mine: false }, over || {});
  }

  function fakeStore(over) {
    var s = {
      calls: [],
      state: Object.assign({ tab: "all", photos: [], total: 0, next: null, status: "ready", error: null,
        fromSaved: false, uploadsOpen: true, full: false, account: null, deleting: [], deleteError: null }, over || {}),
      subscribe: function (fn) { s.fn = fn; return function () {}; },
      load: function (tab) { s.calls.push(["load", tab]); return Promise.resolve(); },
      loadMore: function () { s.calls.push(["loadMore"]); return Promise.resolve(); },
      refresh: function () { s.calls.push(["refresh"]); return Promise.resolve(); },
      toggleHeart: function (id) { s.calls.push(["toggleHeart", id]); },
    };
    return s;
  }

  function gridRoot() {
    var root = document.createElement("div");
    root.className = "gallery-root";
    root.style.cssText = "position:fixed;top:0;left:0;width:390px;height:600px;overflow:auto;background:#fff";
    document.body.append(root);
    return root;
  }

  function makeGrid(store, extra) {
    var root = gridRoot();
    var view = G().viewGrid.create(root, Object.assign({ ctx: ctx(), store: store,
      onOpen: function () {}, onAdd: function () {}, onTab: function () {} }, extra || {}));
    view.render(store.state);
    return { root: root, view: view };
  }

  function makeViewer(store, onDelete) {
    var v = G().viewViewer.create({ ctx: ctx(), store: store, onDelete: onDelete || function () {} });
    document.body.append(v.el);
    return v;
  }

  // Closes via × (history.back) and waits until the viewer is shut.
  function shut(v) {
    if (!v.isOpen()) { v.el.remove(); return Promise.resolve(); }
    v.close();
    return waitFor(function () { return !v.isOpen(); }, "viewer closed").then(function () { v.el.remove(); });
  }

  /* ---------- swipe, and pinch-zoomed in ---------- */

  function swipe(v, fromX, toX) {
    var stage = v.el.querySelector(".g-v-stage");
    var at = function (type, x) {
      stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 300, bubbles: true }));
    };
    at("pointerdown", fromX);
    at("pointerup", toX);
  }

  // Pretends the page is pinch-zoomed to `scale` (undefined = back to normal).
  function zoomTo(scale) {
    if (scale === undefined) delete self.visualViewport.scale;
    else Object.defineProperty(self.visualViewport, "scale", { configurable: true, get: function () { return scale; } });
    self.visualViewport.dispatchEvent(new Event("resize"));
  }

  function viewerOf3() {
    var store = fakeStore({ photos: [photo("s1", { by: "Asha" }), photo("s2", { by: "Bala" }), photo("s3", { by: "Chitra" })], total: 3 });
    var v = makeViewer(store);
    v.open(0);
    v.by = function () { return v.el.querySelector('[data-g="viewer-by"]').textContent; };
    v.touch = function () { return getComputedStyle(v.el.querySelector(".g-v-stage")).touchAction; };
    return v;
  }

  test("swipe changes the photo", function () {
    var v = viewerOf3();
    swipe(v, 300, 100);
    var after = v.by();
    swipe(v, 100, 300);
    var back = v.by();
    return shut(v).then(function () {
      ok(after.indexOf("Bala") >= 0, "swipe left: next photo, got " + after);
      ok(back.indexOf("Asha") >= 0, "swipe right: previous photo, got " + back);
    });
  });

  test("zoomed in: one finger moves the photo, arrows still change it", function () {
    var v = viewerOf3();
    var out = {};
    try {
      out.normalTouch = v.touch();
      zoomTo(2);
      out.zoomedTouch = v.touch();
      swipe(v, 300, 100);
      out.afterSwipe = v.by();
      v.el.querySelector('[data-g="viewer-next"]').click();
      out.afterArrow = v.by();
    } finally {
      zoomTo(undefined);
    }
    out.backTouch = v.touch();
    swipe(v, 300, 100);
    out.swipeAgain = v.by();
    return shut(v).then(function () {
      eq(out.normalTouch, "pinch-zoom", "not zoomed: sideways moves come to the viewer");
      // "manipulation" is how browsers write pan-x pan-y pinch-zoom.
      ok(out.zoomedTouch === "manipulation" || (/pan-x/.test(out.zoomedTouch) && /pan-y/.test(out.zoomedTouch)),
        "zoomed: one-finger pan allowed, got " + out.zoomedTouch);
      ok(out.afterSwipe.indexOf("Asha") >= 0, "swipe ignored while zoomed, got " + out.afterSwipe);
      ok(out.afterArrow.indexOf("Bala") >= 0, "arrow works while zoomed, got " + out.afterArrow);
      eq(out.backTouch, "pinch-zoom", "zoomed out again");
      ok(out.swipeAgain.indexOf("Chitra") >= 0, "swipe works again, got " + out.swipeAgain);
    });
  });

  test("names render as text", function () {
    var store = fakeStore({ photos: [photo("x1", { by: "<img src=x onerror=alert(1)>" })], total: 1 });
    var v = makeViewer(store);
    v.open(0);
    ok(v.isOpen(), "viewer open");
    ok(!document.querySelector('img[src="x"]'), "markup became an element");
    ok(v.el.querySelector('[data-g="viewer-by"]').textContent.indexOf("<img") >= 0, "name shown as text");
    return shut(v);
  });

  test("two columns", function () {
    var store = fakeStore({ photos: [photo("a"), photo("b"), photo("c")], total: 3 });
    var g = makeGrid(store);
    var cols = getComputedStyle(g.root.querySelector('[data-g="grid"]')).gridTemplateColumns.trim().split(/\s+/);
    g.root.remove();
    eq(cols.length, 2);
  });

  test("tiles show hearts and lazy thumbnails", function () {
    var store = fakeStore({ photos: [photo("a", { hearts: 3, hearted: true }), photo("b", { hearts: 1 })], total: 2 });
    var g = makeGrid(store);
    var tiles = g.root.querySelectorAll('[data-g="tile"]');
    eq(tiles.length, 2);
    eq(tiles[0].dataset.id, "a");
    var img = tiles[0].querySelector("img");
    eq([img.getAttribute("loading"), img.getAttribute("decoding")], ["lazy", "async"]);
    eq(img.getAttribute("src"), fill(self.SITE_CONFIG.gallery.thumbUrl, { id: "a", size: self.SITE_CONFIG.gallery.thumbSizePx }));
    var heart = tiles[0].querySelector('[data-g="heart"]');
    ok(heart.textContent.indexOf("3") >= 0, "count shown");
    eq(heart.getAttribute("aria-pressed"), "true");
    eq(tiles[1].querySelector('[data-g="heart"]').getAttribute("aria-pressed"), "false");
    var sub = g.root.querySelector('[data-g="subtitle"]').textContent;
    g.root.remove();
    eq(sub, fill(T().subtitle, { count: 2 }));
  });

  test("heart tap hearts, tile tap opens", function () {
    var store = fakeStore({ photos: [photo("a"), photo("b")], total: 2 });
    var opened = [];
    var g = makeGrid(store, { onOpen: function (i) { opened.push(i); } });
    var tiles = g.root.querySelectorAll('[data-g="tile"]');
    tiles[1].querySelector('[data-g="heart"]').click();
    tiles[1].querySelector("img").click();
    g.root.remove();
    eq(store.calls, [["toggleHeart", "b"]]);
    eq(opened, [1]);
  });

  test("re-render keeps tiles and prepends", function () {
    var store = fakeStore({ photos: [photo("a"), photo("b")], total: 2 });
    var g = makeGrid(store);
    var tileA = g.root.querySelector('[data-id="a"]');
    g.view.render(Object.assign({}, store.state, { photos: [photo("n"), photo("a", { hearts: 4 }), photo("b")], total: 3 }));
    var ids = [].map.call(g.root.querySelectorAll('[data-g="tile"]'), function (t) { return t.dataset.id; });
    var same = g.root.querySelector('[data-id="a"]') === tileA;
    var count = tileA.querySelector('[data-g="heart"]').textContent;
    g.root.remove();
    eq(ids, ["n", "a", "b"]);
    ok(same, "existing tile was rebuilt");
    ok(count.indexOf("4") >= 0, "count updated");
  });

  /* ---------- caption row under each photo: "By name" and the heart ---------- */

  function caption(tile) { return tile.querySelector('[data-g="caption"]'); }

  test("caption shows By and the name in bold, heart below the photo", function () {
    var store = fakeStore({ photos: [photo("a", { by: "Asha", hearts: 2 })], total: 1 });
    var g = makeGrid(store);
    var tile = g.root.querySelector('[data-g="tile"]');
    var cap = caption(tile);
    var by = cap && cap.querySelector('[data-g="by"]');
    var bold = by && by.querySelector("b");
    var heart = tile.querySelector('[data-g="heart"]');
    var inCaption = !!cap && cap.contains(heart);
    var onPhoto = tile.querySelector(".g-open").contains(heart) || tile.querySelector(".g-shot").contains(heart);
    var below = heart.getBoundingClientRect().top >= tile.querySelector("img").getBoundingClientRect().bottom - 0.5;
    var byWeight = by && getComputedStyle(by).fontWeight;
    var boldWeight = bold && getComputedStyle(bold).fontWeight;
    var size = by && parseFloat(getComputedStyle(by).fontSize);
    g.root.remove();
    ok(by, "caption line missing");
    eq(by.textContent, T().byPrefix + " Asha");
    eq(bold && bold.textContent, "Asha", "name in bold");
    ok(Number(byWeight) < 600 && Number(boldWeight) >= 700, "By normal, name bold: " + byWeight + " / " + boldWeight);
    ok(size >= 16, "caption text size " + size);
    ok(inCaption, "heart not in the caption row");
    ok(!onPhoto && below, "heart still on the photo");
  });

  test("caption without a name says By a guest", function () {
    var store = fakeStore({ photos: [photo("a", { by: "" }), photo("b", { by: "   " }), photo("c", { by: null })], total: 3 });
    var g = makeGrid(store);
    var lines = [].map.call(g.root.querySelectorAll('[data-g="tile"]'), function (t) {
      var by = caption(t).querySelector('[data-g="by"]');
      return [by.textContent, !!by.querySelector("b")];
    });
    g.root.remove();
    eq(lines, [[T().byGuest, false], [T().byGuest, false], [T().byGuest, false]]);
  });

  test("markup in a name shows as text in the caption", function () {
    var name = "<img src=x onerror=alert(1)>";
    var store = fakeStore({ photos: [photo("a", { by: name })], total: 1 });
    var g = makeGrid(store);
    var by = caption(g.root.querySelector('[data-g="tile"]')).querySelector('[data-g="by"]');
    var made = by.querySelector("img");
    var text = by.querySelector("b").textContent;
    g.root.remove();
    ok(!made && !document.querySelector('img[src="x"]'), "markup became an element");
    eq(text, name);
  });

  test("caption heart toggles and does not open the photo", function () {
    var store = fakeStore({ tab: "mine", photos: [photo("a", { mine: true, hearts: 1, hearted: true })], total: 1 });
    var opened = [];
    var g = makeGrid(store, { onOpen: function (i) { opened.push(i); }, onDelete: function () {} });
    var tile = g.root.querySelector('[data-g="tile"]');
    var heart = caption(tile).querySelector('[data-g="heart"]');
    var rect = heart.getBoundingClientRect();
    var label = heart.getAttribute("aria-label");
    heart.click();
    g.view.render(Object.assign({}, store.state, { photos: [photo("a", { mine: true, hearts: 0, hearted: false })] }));
    var after = [heart.getAttribute("aria-pressed"), heart.textContent.indexOf("0") >= 0];
    var del = tile.querySelector('[data-g="tile-delete"]');
    var delOnPhoto = !!del && tile.querySelector(".g-shot").contains(del);
    g.root.remove();
    eq(store.calls, [["toggleHeart", "a"]]);
    eq(opened, [], "heart tap opened the viewer");
    eq(label, T().heartLabel);
    ok(rect.width >= 44 && rect.height >= 44, "tap target " + rect.width + "x" + rect.height);
    eq(after, ["false", true]);
    ok(delOnPhoto, "Delete not on the photo in Photos by me");
  });

  test("long names end in an ellipsis and every tile is the same height", function () {
    var long = "Venkata Lakshmi Narasimha Subrahmanyam Garu";
    var up = fakeUploader([{ key: "k1", status: "uploading", progress: 0.3 }, { key: "k2", status: "failed", code: "unavailable" }],
      { finished: 0, total: 2, dropped: 0 });
    var store = fakeStore({ photos: [photo("a", { by: long }), photo("b", { by: "Asha" }), photo("c"), photo("no-such-photo")], total: 4 });
    var g = makeGrid(store, { uploader: up });
    var by = caption(g.root.querySelector('[data-id="a"]')).querySelector('[data-g="by"]');
    var cs = getComputedStyle(by);
    var style = [cs.textOverflow, cs.whiteSpace, cs.overflow];
    var cut = by.scrollWidth > by.clientWidth;
    var oneLine = by.getClientRects().length === 1 && by.getBoundingClientRect().height < 2 * parseFloat(cs.fontSize) * 1.2;
    var grid = g.root.querySelector('[data-g="grid"]');
    var waitBroken = function () { return g.root.querySelector('[data-id="no-such-photo"]').classList.contains("is-broken"); };
    return waitFor(waitBroken, "broken tile").then(function () {
      var heights = [].map.call(grid.children, function (el) { return Math.round(el.getBoundingClientRect().height); });
      var kinds = [].map.call(grid.children, function (el) { return el.dataset.g; });
      g.root.remove();
      eq(style, ["ellipsis", "nowrap", "hidden"]);
      ok(cut, "long name not cut");
      ok(oneLine, "long name wrapped");
      eq(kinds, ["uploading-tile", "failed-tile", "tile", "tile", "tile", "tile"]);
      ok(heights.every(function (x) { return x === heights[0]; }), "tile heights " + heights);
    }, function (e) { g.root.remove(); throw e; });
  });

  test("broken thumbnail becomes a soft placeholder", function () {
    var store = fakeStore({ photos: [photo("no-such-photo")], total: 1 });
    var g = makeGrid(store);
    var tile = g.root.querySelector('[data-g="tile"]');
    return waitFor(function () { return tile.classList.contains("is-broken"); }, "is-broken").then(function () {
      var img = tile.querySelector("img");
      var shown = img && getComputedStyle(img).display !== "none";
      g.root.remove();
      ok(!shown, "broken image still visible");
    });
  });

  // Picture requests the page made for photo `id` so far.
  function thumbRequests(id) {
    return performance.getEntriesByType("resource").map(function (e) { return e.name; })
      .filter(function (n) { return n.indexOf("/mock-api/img/" + id + "?") >= 0; });
  }

  test("broken thumbnails are tried again a few times, then stay soft", function () {
    var id = "gone-" + Date.now();
    var store = fakeStore({ photos: [photo(id)], total: 1 });
    var g = makeGrid(store);
    var tile = g.root.querySelector('[data-g="tile"]');
    var tries = self.SITE_CONFIG.gallery.thumbRetries;
    ok(tries > 0, "gallery.thumbRetries set");
    var settle = function () { return wait(300); };
    return waitFor(function () { return tile.classList.contains("is-broken"); }, "is-broken").then(function () {
      var chain = Promise.resolve();
      for (var i = 0; i < tries + 2; i++) chain = chain.then(function () { g.view.retryThumbs(); return settle(); });
      return chain;
    }).then(function () {
      var urls = thumbRequests(id);
      g.root.remove();
      eq(urls.length, 1 + tries, "first try + retries: " + urls);
      ok(/[?&]retry=1(&|$)/.test(urls[1]) && /[?&]retry=3(&|$)/.test(urls[3]), "retry number in the address: " + urls);
      ok(tile.classList.contains("is-broken"), "soft placeholder after the last try");
    });
  });

  // Shares one generated photo with the stand-in in `mode`; resolves its Photo.
  function shareDirect(mode) {
    var c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    c.getContext("2d").fillRect(0, 0, 64, 48);
    var data = c.toDataURL("image/jpeg", 0.8).split(",")[1];
    var device = "", hex = "0123456789abcdef";
    for (var i = 0; i < 32; i++) device += hex[Math.floor(Math.random() * 16)];
    return fetch("/mock-api?mode=" + mode, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "upload", device: device, name: "", mime: "image/jpeg", data: data }),
    }).then(function (r) { return r.json(); }).then(function (r) { return r.photo; });
  }

  // mock=latethumbs: a photo's picture is "not found" for its first 3 s (like Google's
  // thumbnail of a photo added a moment ago).
  var LATE_THUMB_MS = 3000;

  test("a broken thumbnail shows once a later try works", function () {
    var g, tile;
    return shareDirect("latethumbs").then(function (p) {
      g = makeGrid(fakeStore({ photos: [photo(p.id)], total: 1 }));
      tile = g.root.querySelector('[data-g="tile"]');
      return waitFor(function () { return tile.classList.contains("is-broken"); }, "is-broken").then(function () {
        return wait(Math.max(0, p.at + LATE_THUMB_MS + 300 - Date.now()));
      });
    }).then(function () {
      g.view.retryThumbs();
      return waitFor(function () { return !tile.classList.contains("is-broken"); }, "picture after a retry");
    }).then(function () {
      var img = tile.querySelector("img");
      var src = img.getAttribute("src");
      return waitFor(function () { return img.complete && img.naturalWidth > 0; }, "picture loaded").then(function () {
        g.root.remove();
        ok(/[?&]retry=1(&|$)/.test(src), "shows the retried address: " + src);
      });
    }, function (e) { if (g) g.root.remove(); throw e; });
  }, { timeoutMs: 15000 });

  test("error state has try again", function () {
    var store = fakeStore({ status: "error", error: "unavailable" });
    var g = makeGrid(store);
    var state = g.root.querySelector('[data-g="state"]');
    var again = g.root.querySelector('[data-g="try-again"]');
    var text = g.root.textContent;
    if (again) again.click();
    g.root.remove();
    ok(state, "calm card missing");
    ok(again, "Try again missing");
    ok(text.indexOf(T().errorTitle) >= 0, "error title missing");
    ok(text.indexOf("unavailable") < 0, "raw code shown");
    eq(store.calls, [["load", "all"]]);
  });

  test("offline state uses offline words", function () {
    var store = fakeStore({ status: "error", error: "offline" });
    var g = makeGrid(store);
    var text = g.root.textContent;
    g.root.remove();
    ok(text.indexOf(T().offlineTitle) >= 0, "offline title missing");
  });

  test("saved list shows notice and try again", function () {
    var store = fakeStore({ photos: [photo("a")], total: 1, fromSaved: true, error: "unavailable" });
    var g = makeGrid(store);
    var text = g.root.textContent;
    var again = g.root.querySelector('[data-g="try-again"]');
    if (again) again.click();
    var tiles = g.root.querySelectorAll('[data-g="tile"]').length;
    g.root.remove();
    ok(text.indexOf(T().savedNotice) >= 0, "saved notice missing");
    eq(tiles, 1);
    eq(store.calls, [["load", "all"]]);
  });

  test("empty state", function () {
    var store = fakeStore({ status: "ready", photos: [], total: 0 });
    var g = makeGrid(store);
    var text = g.root.textContent;
    var add = g.root.querySelector('[data-g="add"]');
    g.root.remove();
    ok(text.indexOf(T().emptyTitle) >= 0, "empty title missing");
    ok(add, "Add photos missing");
  });

  test("flags do not break the grid", function () {
    var store = fakeStore({ photos: [photo("a")], total: 1, uploadsOpen: false, full: true });
    var g = makeGrid(store);
    var tiles = g.root.querySelectorAll('[data-g="tile"]').length;
    g.root.remove();
    eq(tiles, 1);
  });

  /* ---------- uploads in the grid ---------- */

  // items: [{ key, status, code?, progress? }]; counts: { finished, total, dropped }.
  function fakeUploader(items, counts) {
    var u = { retried: [] };
    u.items = function () {
      return items.map(function (i) { return Object.assign({ previewUrl: null, code: null, progress: 0 }, i); });
    };
    u.busy = function () { return items.some(function (i) { return /waiting|preparing|uploading/.test(i.status); }); };
    u.counts = function () { return counts || { finished: 0, total: items.length, dropped: 0 }; };
    u.retry = function (key) { u.retried.push(key); };
    return u;
  }

  function addShown(root) {
    var add = root.querySelector('[data-g="add"]');
    return !!add && add.offsetParent !== null;
  }

  test("paused note replaces Add", function () {
    var a = makeGrid(fakeStore({ photos: [photo("a")], total: 1, uploadsOpen: false }));
    var aNote = a.root.querySelector('[data-g="paused"]');
    var aText = aNote && aNote.textContent;
    var aPinned = !!aNote && !!aNote.closest(".g-addbar") && aNote.getClientRects().length > 0;
    var aAdd = addShown(a.root);
    a.root.remove();
    var sheetOpen = true;
    var bStore = fakeStore({ photos: [photo("a")], total: 1 });
    var b = makeGrid(bStore, { sheetOpen: function () { return sheetOpen; } });
    var bBefore = !!b.root.querySelector('[data-g="paused"]') || !addShown(b.root);
    sheetOpen = false;
    b.view.render(bStore.state);
    var bNote = !!b.root.querySelector('[data-g="paused"]');
    var bAdd = addShown(b.root);
    var tiles = b.root.querySelectorAll('[data-g="tile"]').length;
    b.root.remove();
    eq(aText, T().pausedNote);
    ok(aPinned, "paused note is not in the pinned spot of Add photos");
    ok(!aAdd, "Add shown while the server says paused");
    ok(!bBefore, "paused while open");
    ok(bNote && !bAdd, "Sheet pause did not replace Add");
    eq(tiles, 1);
  });

  test("full note links to contacts", function () {
    var went = 0;
    var c = ctx();
    c.goContacts = function () { went++; };
    var store = fakeStore({ photos: [photo("a")], total: 1, full: true });
    var root = gridRoot();
    var view = G().viewGrid.create(root, { ctx: c, store: store, onOpen: function () {}, onAdd: function () {}, onTab: function () {} });
    view.render(store.state);
    var note = root.querySelector('[data-g="full"]');
    var text = note && note.textContent;
    var add = addShown(root);
    var button = note && note.querySelector("button");
    var pinned = !!note && !!note.closest(".g-addbar") && note.getClientRects().length > 0;
    if (button) button.click();
    root.remove();
    ok(note, "full note missing");
    ok(text.indexOf(T().fullNote) >= 0, "full wording missing");
    ok(!add, "Add shown while full");
    ok(pinned, "full note is not in the pinned spot of Add photos");
    eq([button && button.textContent, went], [T().fullAction, 1]);
  });

  test("upload tiles come first and failed ones retry", function () {
    var up = fakeUploader([
      { key: "k1", status: "uploading", progress: 0.5 },
      { key: "k2", status: "failed", code: "unavailable" },
      { key: "k3", status: "failed", code: "unsupported" },
      { key: "k4", status: "done" },
    ], { finished: 3, total: 4, dropped: 0 });
    var g = makeGrid(fakeStore({ photos: [photo("a")], total: 1 }), { uploader: up });
    var kids = [].map.call(g.root.querySelector('[data-g="grid"]').children, function (el) { return el.dataset.g; });
    var failed = g.root.querySelectorAll('[data-g="failed-tile"]');
    var texts = [].map.call(failed, function (el) { return el.textContent; });
    failed[0].click();
    var line = g.root.querySelector('[data-g="uploading"]');
    var lineText = line && line.textContent;
    g.root.remove();
    eq(kids, ["uploading-tile", "failed-tile", "failed-tile", "tile"]);
    eq(texts, [T().uploadFailed, T().unsupported]);
    eq(up.retried, ["k2"]);
    ok(lineText.indexOf(fill(T().uploading, { done: 4, total: 4 })) >= 0, "uploading line: " + lineText);
    ok(lineText.indexOf(T().keepOpen) >= 0, "keep open missing");
  });

  test("uploading line only while busy, too many noted", function () {
    var idle = fakeUploader([{ key: "k2", status: "failed", code: "unavailable" }]);
    var a = makeGrid(fakeStore({ photos: [], total: 0 }), { uploader: idle });
    var aLine = a.root.querySelector('[data-g="uploading"]');
    a.root.remove();
    var busy = fakeUploader([{ key: "k1", status: "waiting" }], { finished: 0, total: 20, dropped: 5 });
    var b = makeGrid(fakeStore({ photos: [], total: 0 }), { uploader: busy });
    var text = b.root.textContent;
    b.root.remove();
    ok(!aLine, "uploading line shown while idle");
    ok(text.indexOf(fill(T().tooMany, { max: self.SITE_CONFIG.gallery.maxPhotosPerUpload })) >= 0, "too many missing");
    ok(text.indexOf(fill(T().uploading, { done: 1, total: 20 })) >= 0, "uploading 1 of 20 missing");
  });

  test("tabs call onTab", function () {
    var store = fakeStore({ photos: [photo("a")], total: 1 });
    var tabs = [];
    var g = makeGrid(store, { onTab: function (t) { tabs.push(t); } });
    g.root.querySelector('[data-g="tab-mine"]').click();
    var pressed = g.root.querySelector('[data-g="tab-all"]').getAttribute("aria-pressed");
    g.root.remove();
    eq(tabs, ["mine"]);
    eq(pressed, "true");
  });

  test("delete only on own photo", function () {
    var store = fakeStore({ photos: [photo("a"), photo("b", { mine: true })], total: 2 });
    var v = makeViewer(store);
    v.open(0);
    var before = v.el.querySelector('[data-g="viewer-delete"]');
    v.el.querySelector('[data-g="viewer-next"]').click();
    var after = v.el.querySelector('[data-g="viewer-delete"]');
    var counter = v.el.textContent;
    return shut(v).then(function () {
      ok(!before, "delete shown on someone else's photo");
      ok(after, "delete missing on own photo");
      ok(counter.indexOf(fill(T().counter, { n: 2, total: 2 })) >= 0, "counter missing");
    });
  });

  /* ---------- Photos by me and delete ---------- */

  function tileDeletes(root) { return root.querySelectorAll('[data-g="tile-delete"]'); }

  test("mine tab shows delete buttons", function () {
    var deletes = [];
    var opened = [];
    var store = fakeStore({ tab: "mine", photos: [photo("a", { mine: true }), photo("b", { mine: true })], total: 2 });
    var g = makeGrid(store, {
      onDelete: function (id) { deletes.push(id); },
      onOpen: function (i) { opened.push(i); },
    });
    var buttons = tileDeletes(g.root);
    var rect = buttons[0].getBoundingClientRect();
    var kinds = [].map.call(buttons, function (b) { return b.tagName + ":" + b.type; });
    var label = buttons[0].textContent;
    buttons[1].click();
    var sub = g.root.querySelector('[data-g="subtitle"]').textContent;
    g.view.render(Object.assign({}, store.state, { deleting: ["a"] }));
    var waiting = [].map.call(tileDeletes(g.root), function (b) { return b.disabled; });
    g.root.remove();
    eq(buttons.length, 2);
    eq(kinds, ["BUTTON:button", "BUTTON:button"]);
    eq(label, T().delete);
    ok(rect.width >= 44 && rect.height >= 44, "tap target " + rect.width + "x" + rect.height);
    eq(deletes, ["b"]);
    eq(opened, [], "delete tap opened the viewer");
    eq(sub, T().mineSubtitle);
    eq(waiting, [true, false], "the one being deleted can't be tapped again");
  });

  test("all tab has no delete buttons", function () {
    var mine = [photo("a", { mine: true }), photo("b", { mine: true })];
    var store = fakeStore({ tab: "all", photos: mine, total: 2 });
    var g = makeGrid(store);
    var all1 = tileDeletes(g.root).length;
    g.view.render(Object.assign({}, store.state, { tab: "mine" }));
    var mineN = tileDeletes(g.root).length;
    g.view.render(Object.assign({}, store.state, { tab: "all" }));
    var all2 = tileDeletes(g.root).length;
    g.root.remove();
    eq([all1, mineN, all2], [0, 2, 0]);
  });

  test("Photos by me empty", function () {
    var store = fakeStore({ tab: "mine", photos: [], total: 0 });
    var g = makeGrid(store);
    var text = g.root.textContent;
    var sub = g.root.querySelector('[data-g="subtitle"]');
    var add = addShown(g.root);
    g.root.remove();
    ok(text.indexOf(T().mineEmpty) >= 0, "mineEmpty missing");
    ok(!sub.hidden && sub.textContent === T().mineSubtitle, "subtitle missing");
    ok(add, "Add photos missing");
  });

  test("delete failure shows a calm line", function () {
    var store = fakeStore({ tab: "mine", photos: [photo("a", { mine: true })], total: 1,
      deleteError: { id: "a", code: "unavailable" } });
    var g = makeGrid(store);
    var line = function () { return g.root.querySelector('[data-g="delete-failed"]'); };
    var first = line() && line().textContent;
    var role = line() && line().getAttribute("role");
    var shown = !!line() && line().getClientRects().length > 0;
    g.view.render(Object.assign({}, store.state, { deleteError: { id: "a", code: "forbidden" } }));
    var second = line() && line().textContent;
    g.view.render(Object.assign({}, store.state, { deleteError: null }));
    var after = line();
    var tiles = g.root.querySelectorAll('[data-g="tile"]').length;
    g.root.remove();
    eq(first, T().errors.unavailable);
    eq(role, "status");
    ok(shown, "line not visible");
    eq(second, T().errors.forbidden);
    eq(after, null);
    eq(tiles, 1, "photo stays");
  });

  test("viewer delete asks, waits and says why it failed", function () {
    var asked = [];
    var store = fakeStore({ photos: [photo("a", { mine: true })], total: 1 });
    var v = makeViewer(store, function (id) { asked.push(id); });
    v.open(0);
    var del = function () { return v.el.querySelector('[data-g="viewer-delete"]'); };
    del().click();
    store.state = Object.assign({}, store.state, { deleting: ["a"] });
    store.fn(store.state);
    var waiting = del().disabled;
    store.state = Object.assign({}, store.state, { deleting: [], deleteError: { id: "a", code: "forbidden" } });
    store.fn(store.state);
    var status = v.el.querySelector('[data-g="viewer-status"]');
    var text = status && status.textContent;
    var again = del().disabled;
    return shut(v).then(function () {
      eq(asked, ["a"]);
      ok(waiting, "delete button still tappable while sending");
      eq(text, T().errors.forbidden);
      ok(!again, "delete button stuck after a failure");
    });
  });

  test("viewer closes when its photo is deleted", function () {
    var store = fakeStore({ photos: [photo("a"), photo("b", { mine: true }), photo("c")], total: 3 });
    var v = makeViewer(store);
    v.open(1);
    var backs = 0;
    var back = history.back;
    history.back = function () { backs++; return back.call(history); };
    store.state = Object.assign({}, store.state, { photos: [photo("a"), photo("c")], total: 2 });
    store.fn(store.state);
    store.fn(store.state);   // a second change before Back has landed
    return waitFor(function () { return !v.isOpen(); }, "viewer closed").then(function () {
      history.back = back;
      v.el.remove();
      eq(backs, 1, "Back asked for once");
    }, function (e) { history.back = back; v.el.remove(); throw e; });
  });

  test("viewer heart and time", function () {
    var now = new Date();
    var store = fakeStore({ photos: [photo("a", { hearts: 7, at: now.getTime() })], total: 1 });
    var v = makeViewer(store);
    v.open(0);
    var heart = v.el.querySelector('[data-g="viewer-heart"]');
    heart.click();
    var time = new Intl.DateTimeFormat(self.SITE_CONFIG.locale, { hour: "numeric", minute: "2-digit" }).format(now);
    var text = v.el.textContent;
    return shut(v).then(function () {
      ok(heart.textContent.indexOf("7") >= 0, "count missing");
      eq(store.calls, [["toggleHeart", "a"]]);
      ok(text.indexOf(fill(T().today, { time: time })) >= 0, "today line missing: " + text);
    });
  });

  test("viewer asks for more at the last photo", function () {
    var store = fakeStore({ photos: [photo("a"), photo("b")], total: 5, next: "2" });
    var v = makeViewer(store);
    v.open(1);
    var next = v.el.querySelector('[data-g="viewer-next"]');
    return shut(v).then(function () {
      eq(store.calls, [["loadMore"]]);
      ok(next, "next arrow missing");
    });
  });

  /* ---------- Google sign-in card (Photos by me) ---------- */

  // A grid with sign-in switched on; mounted = the elements the Google button went into.
  function signInGrid(over) {
    var store = fakeStore(over);
    var s = { mounted: [], signOuts: 0 };
    s.store = store;
    s.g = makeGrid(store, { signIn: {
      mountButton: function (el) { s.mounted.push(el); },
      signOut: function () { s.signOuts++; return Promise.resolve(); },
    } });
    s.q = function (sel) { return s.g.root.querySelector(sel); };
    return s;
  }

  test("sign-in card only on Photos by me", function () {
    var s = signInGrid({ photos: [photo("a")], total: 1 });
    var onAll = shown(s.q('[data-g="signin-card"]')) || shown(s.q('[data-g="signin"]'));
    var mountedOnAll = s.mounted.length;
    s.store.state = Object.assign({}, s.store.state, { tab: "mine", photos: [photo("a", { mine: true })] });
    s.g.view.render(s.store.state);
    var card = s.q('[data-g="signin-card"]');
    var text = card ? card.textContent : "";
    var box = s.q('[data-g="signin"]');
    s.g.view.render(s.store.state);
    var mountedTwice = s.mounted.length;
    var loading = Object.assign({}, s.store.state, { status: "loading" });
    s.g.view.render(loading);
    var whileLoading = shown(s.q('[data-g="signin-card"]'));
    s.g.root.remove();
    eq([onAll, mountedOnAll], [false, 0], "nothing on All photos, Google not loaded");
    ok(text.indexOf(T().otherPhoneTitle) >= 0, "title missing");
    ok(text.indexOf(T().signInNote) >= 0, "note missing");
    ok(box && s.mounted[0] === box, "Google button not mounted into the sign-in box");
    eq(mountedTwice, 1, "button mounted once");
    eq(whileLoading, false, "card shown before Photos by me loaded");
  });

  test("signed in card shows the name as text and signs out", function () {
    var s = signInGrid({ tab: "mine", photos: [], account: { name: "<b>Ravi</b>" } });
    var line = s.q('[data-g="signed-in"]');
    var lineShown = shown(line);
    var box = shown(s.q('[data-g="signin"]'));
    var mounted = s.mounted.length;
    s.q('[data-g="signout"]').click();
    var bold = s.q("b");
    s.g.root.remove();
    ok(lineShown, "signed-in line missing");
    eq(line.textContent, fill(T().signedInAs, { name: "<b>Ravi</b>" }));
    ok(!bold, "name became markup");
    eq([box, mounted], [false, 0], "no Google button when signed in");
    eq(s.signOuts, 1);
  });

  test("sign-out failure keeps signed in and says so", function () {
    var store = fakeStore({ tab: "mine", photos: [], account: { name: "Ravi" } });
    var fail;
    var g = makeGrid(store, { signIn: {
      mountButton: function () {},
      signOut: function () { return new Promise(function (_, reject) { fail = reject; }); },
    } });
    var q = function (sel) { return g.root.querySelector(sel); };
    q('[data-g="signout"]').click();
    var busy = q('[data-g="signout"]').disabled;
    fail(new (G().errors.GalleryError)("offline"));
    return wait(20).then(function () {
      var msg = q('[data-g="signout-failed"]');
      var said = shown(msg) ? msg.textContent : "";
      var still = shown(q('[data-g="signed-in"]'));
      var usable = !q('[data-g="signout"]').disabled;
      g.root.remove();
      eq(busy, true, "button busy while signing out");
      eq(said, T().signOutFailed);
      eq([still, usable], [true, true]);
    });
  });

  test("sign-in card has a Privacy link, signed out and signed in", function () {
    var s = signInGrid({ tab: "mine", photos: [], total: 0 });
    var link = function () {
      var card = [].filter.call(s.g.root.querySelectorAll('[data-g="signin-card"]'), shown)[0];
      var a = card && card.querySelector('a[data-g="privacy-link"]');
      return a && shown(a) ? [a.textContent, a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")] : null;
    };
    var out = link();
    s.store.state = Object.assign({}, s.store.state, { account: { name: "Ravi" } });
    s.g.view.render(s.store.state);
    var inn = link();
    s.g.root.remove();
    // A new tab: leaving the page would stop running uploads.
    var want = [T().privacyLink, self.SITE_CONFIG.gallery.privacyUrl, "_blank", "noopener"];
    eq(out, want, "signed out");
    eq(inn, want, "signed in");
  });

  test("signed in without a name", function () {
    var s = signInGrid({ tab: "mine", photos: [], account: { name: "" } });
    var line = s.q('[data-g="signed-in"]').textContent;
    s.g.root.remove();
    eq(line, T().signedInNoName);
  });

  test("no sign-in card without sign-in", function () {
    var store = fakeStore({ tab: "mine", photos: [], total: 0 });
    var g = makeGrid(store);
    var card = g.root.querySelector('[data-g="signin-card"], [data-g="signin"]');
    g.root.remove();
    eq(card, null);
  });

  test("back closes viewer", function () {
    var f = document.createElement("iframe");
    f.style.cssText = "width:390px;height:700px";
    document.body.appendChild(f);
    f.src = "/index.html#gallery";
    var doc = function () { return f.contentDocument; };
    var viewer = function () { return doc().querySelector('#gallery-body [data-g="viewer"]'); };
    return waitFor(function () { return doc().querySelector('#gallery-body [data-g="tile"]'); }, "tile").then(function (tile) {
      tile.querySelector("img").click();
      return waitFor(function () { return viewer() && !viewer().hidden; }, "viewer open");
    }).then(function () {
      var popped = new Promise(function (r) { f.contentWindow.addEventListener("popstate", r, { once: true }); });
      f.contentWindow.history.back();
      return popped;
    }).then(function () {
      return waitFor(function () { return viewer().hidden; }, "viewer closed");
    }).then(function () {
      return wait(100);
    }).then(function () {
      eq(f.contentWindow.location.hash, "#gallery");
      ok(!doc().getElementById("view-gallery").hidden, "left the Gallery");
      f.remove();
    }, function (e) { f.remove(); throw e; });
  });

  /* ---------- delete on the real site (stand-in backend) ---------- */

  function jpegFile(win) {
    var c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    var g = c.getContext("2d");
    g.fillStyle = "#7b9cc9";
    g.fillRect(0, 0, 640, 480);
    return new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.8); }).then(function (blob) {
      return new win.File([blob], "photo.jpg", { type: "image/jpeg" });
    });
  }

  // Longest wait for the iframe's Gallery to load or an upload to land (late in a full run
  // the page can take more than the default 3.5 s); each test still has its own 15 s limit.
  var PAGE_MS = 6000;

  // The Gallery in an iframe, with the backend actions the page sends recorded.
  function galleryFrame(src) {
    var f = document.createElement("iframe");
    f.style.cssText = "width:390px;height:700px";
    document.body.appendChild(f);
    f.src = src;
    var t = { f: f, sent: [] };
    t.q = function (sel) { return f.contentDocument.querySelector("#gallery-body " + sel); };
    t.tileIds = function () {
      return [].map.call(f.contentDocument.querySelectorAll('#gallery-body [data-g="tile"]'), function (el) { return el.dataset.id; });
    };
    t.ready = waitFor(function () { return t.q('[data-g="tile"]'); }, "tile", PAGE_MS).then(function () {
      var win = f.contentWindow;
      var real = win.fetch;
      win.fetch = function (url, init) {
        try { t.sent.push(JSON.parse(init.body).action); } catch (e) { /* not a backend call */ }
        return real.apply(this, arguments);
      };
    });
    return t;
  }

  // Picks one generated photo like a guest, taps Upload; resolves the new photo's id.
  // beforeUpload(): called while the panel is open, before Upload is tapped.
  function uploadOne(t, beforeUpload) {
    var before = t.tileIds();
    return jpegFile(t.f.contentWindow).then(function (file) {
      t.q('[data-g="add"]').click();
      var dt = new t.f.contentWindow.DataTransfer();
      dt.items.add(file);
      var input = t.q('input[type="file"]');
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return waitFor(function () { var p = t.q('[data-g="panel"]'); return p && !p.hidden && t.q('[data-g="panel-upload"]'); }, "panel");
    }).then(function (upload) {
      if (beforeUpload) beforeUpload();
      upload.click();
      return waitFor(function () {
        if (t.q('[data-g="uploading-tile"]') || t.q('[data-g="failed-tile"]')) return null;
        return t.tileIds().filter(function (id) { return before.indexOf(id) < 0; })[0];
      }, "uploaded photo in the grid", PAGE_MS);
    });
  }

  function shown(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }

  test("delete from Photos by me", function () {
    var t = galleryFrame("/index.html?mock=ok#gallery");
    var id, del;
    var deletes = function () { return t.sent.filter(function (a) { return a === "delete"; }).length; };
    return t.ready.then(function () {
      return uploadOne(t);
    }).then(function (newId) {
      id = newId;
      t.q('[data-g="tab-mine"]').click();
      return waitFor(function () {
        var ids = t.tileIds();
        return ids.length === 1 && ids[0] === id && t.q('[data-g="subtitle"]').textContent === T().mineSubtitle;
      }, "1 tile in Photos by me");
    }).then(function () {
      del = t.q('[data-g="tile-delete"]');
      ok(shown(del), "tile delete button missing");
      del.click();
      ok(shown(t.q('[data-g="confirm"]')), "Remove / Keep not asked");
      ok(t.q('[data-g="confirm"]').textContent.indexOf(T().confirmTitle) >= 0, "question text");
      ok(t.q('[data-g="viewer"]').hidden, "delete tap opened the viewer");
      t.q('[data-g="confirm-keep"]').click();
      return wait(400);
    }).then(function () {
      eq(deletes(), 0, "cancelled confirm sent a delete");
      eq(t.tileIds(), [id], "kept photo still there");
      ok(!shown(t.q('[data-g="confirm"]')), "question still open after Keep");
      del.click();
      t.q('[data-g="confirm-remove"]').click();
      return waitFor(function () { return t.tileIds().length === 0 && t.q('[data-g="state"]'); }, "tile gone");
    }).then(function () {
      eq(deletes(), 1);
      ok(t.q('[data-g="state"]').textContent.indexOf(T().mineEmpty) >= 0, "empty Photos by me");
      ok(shown(t.q('[data-g="add"]')), "Add photos missing");
      t.q('[data-g="tab-all"]').click();
      return waitFor(function () { return t.tileIds().length >= 20 && t.q('[data-g="tab-all"]').getAttribute("aria-pressed") === "true"; }, "All photos");
    }).then(function () {
      ok(t.tileIds().indexOf(id) < 0, "deleted photo still in All photos");
      t.f.remove();
    }, function (e) { t.f.remove(); throw e; });
  }, { timeoutMs: 15000 });

  test("viewer delete closes the viewer", function () {
    var t = galleryFrame("/index.html?mock=ok#gallery");
    var id;
    var viewer = function () { return t.q('[data-g="viewer"]'); };
    return t.ready.then(function () {
      return uploadOne(t);
    }).then(function (newId) {
      id = newId;
      t.q('[data-id="' + id + '"] img').click();
      return waitFor(function () { return !viewer().hidden && viewer().querySelector('[data-g="viewer-delete"]'); }, "viewer with Delete");
    }).then(function (del) {
      del.click();
      ok(shown(t.q('[data-g="confirm"]')), "Remove / Keep not asked");
      t.q('[data-g="confirm-remove"]').click();
      return waitFor(function () { return viewer().hidden; }, "viewer closed");
    }).then(function () {
      return wait(300);
    }).then(function () {
      ok(t.tileIds().indexOf(id) < 0, "deleted photo still in the grid");
      eq(t.f.contentWindow.location.hash, "#gallery");
      ok(!t.f.contentDocument.getElementById("view-gallery").hidden, "left the Gallery");
      t.f.remove();
    }, function (e) { t.f.remove(); throw e; });
  }, { timeoutMs: 15000 });

  test("a fresh upload shows its own picture until the real one loads", function () {
    var t = galleryFrame("/index.html?mock=latethumbs#gallery");
    var id, img, preview, sharedAt;
    return t.ready.then(function () {
      return uploadOne(t);
    }).then(function (newId) {
      sharedAt = Date.now();
      id = newId;
      img = t.q('[data-id="' + id + '"] img');
      preview = img.getAttribute("src");
      ok(/^blob:/.test(preview), "tile shows the phone's own copy: " + preview);
      return wait(600);
    }).then(function () {
      var tile = t.q('[data-id="' + id + '"]');
      ok(!tile.classList.contains("is-broken"), "grey placeholder while Google's picture isn't ready");
      eq(img.getAttribute("src"), preview, "still the phone's copy");
      return wait(Math.max(0, sharedAt + LATE_THUMB_MS + 300 - Date.now()));
    }).then(function () {
      t.f.contentDocument.dispatchEvent(new Event("visibilitychange"));   // a refresh, as when coming back
      return waitFor(function () { return img.getAttribute("src").indexOf("/mock-api/img/" + id) >= 0; }, "real picture", PAGE_MS);
    }).then(function () {
      ok(!t.q('[data-id="' + id + '"]').classList.contains("is-broken"), "real picture shown");
      return t.f.contentWindow.fetch(preview).then(function () { return "kept"; }, function () { return "freed"; });
    }).then(function (after) {
      eq(after, "freed", "phone's copy freed once the real picture showed");
      t.f.remove();
    }, function (e) { t.f.remove(); throw e; });
  }, { timeoutMs: 15000 });

  /* ---------- Google sign-in on the real site (stand-in backend + stand-in GIS) ---------- */

  // A new phone: no device code and no account kept (the iframes share this page's storage).
  function newPhone() {
    localStorage.removeItem("gallery-device");
    localStorage.removeItem("gallery-account");
  }

  function gisLoaded(t) {
    var w = t.f.contentWindow;
    return !!w.google || [].some.call(t.f.contentDocument.scripts, function (s) { return /fake-gis/.test(s.src); });
  }

  // Photos by me, then the stand-in Google button once it is there.
  function googleButton(t) {
    t.q('[data-g="tab-mine"]').click();
    return waitFor(function () { return t.q('[data-g="signin"] [data-fake-gis="button"]'); }, "Google button", PAGE_MS);
  }

  function signedIn(t) {
    return waitFor(function () {
      var s = t.q('[data-g="signed-in"]');
      return shown(s) && s.textContent === fill(T().signedInAs, { name: "Ravi Kumar" }) && s;
    }, "signed in as Ravi Kumar", PAGE_MS);
  }

  // Signs out (if signed in) and waits for the Google button to come back.
  function signOut(t) {
    var out = t.q('[data-g="signout"]');
    if (!shown(out)) return Promise.resolve();
    out.click();
    return waitFor(function () { return shown(t.q('[data-g="signin"]')); }, "signed out", PAGE_MS);
  }

  // The stand-in's record of a photo, as this phone sees it.
  function standInPhoto(id) {
    return fetch("/mock-api?mode=ok", { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "list", device: localStorage.getItem("gallery-device"), limit: 60, mine: true }) })
      .then(function (r) { return r.json(); })
      .then(function (b) { return (b.photos || []).filter(function (p) { return p.id === id; })[0] || null; });
  }

  function openPanel(t) {
    return jpegFile(t.f.contentWindow).then(function (file) {
      t.q('[data-g="add"]').click();
      var dt = new t.f.contentWindow.DataTransfer();
      dt.items.add(file);
      var input = t.q('input[type="file"]');
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return waitFor(function () { var p = t.q('[data-g="panel"]'); return p && !p.hidden && p; }, "panel");
    });
  }

  test("sign in with Google, share under that name, sign out", function () {
    newPhone();
    var t = galleryFrame("/index.html?mock=ok#gallery");
    var id;
    return t.ready.then(function () {
      ok(!gisLoaded(t), "Google script loaded before any sign-in control was shown");
      return googleButton(t);
    }).then(function (button) {
      var card = t.q('[data-g="signin-card"]');
      ok(card.textContent.indexOf(T().otherPhoneTitle) >= 0, "card title");
      ok(card.textContent.indexOf(T().signInNote) >= 0, "card note");
      ok(t.q('[data-g="signin"]').getBoundingClientRect().height >= 44, "room for Google's button");
      button.click();
      return signedIn(t);
    }).then(function () {
      ok(t.sent.indexOf("link") >= 0, "link sent");
      ok(!shown(t.q('[data-g="signin"]')), "Google button still shown");
      return uploadOne(t, function () {
        ok(!shown(t.q('[data-g="name"]')), "name box shown while signed in");
        ok(!shown(t.q('[data-g="use-google"]')), "Google link shown while signed in");
      });
    }).then(function (newId) {
      id = newId;
      return standInPhoto(id);
    }).then(function (p) {
      ok(p, "uploaded photo not found");
      eq(p.by, "Ravi Kumar", "shared under the Google name");
      return signOut(t);
    }).then(function () {
      ok(t.sent.indexOf("unlink") >= 0, "unlink sent");
      eq(localStorage.getItem("gallery-account"), "null", "account forgotten on the phone");
      return openPanel(t);
    }).then(function () {
      ok(shown(t.q('[data-g="name"]')), "name box back after sign-out");
      ok(shown(t.q('[data-g="use-google"]')), "Google link back after sign-out");
      t.q('[data-g="panel-close"]').click();
      t.f.remove();
      newPhone();
    }, function (e) { t.f.remove(); newPhone(); throw e; });
  }, { timeoutMs: 15000 });

  test("linking claims earlier uploads", function () {
    newPhone();
    var t = galleryFrame("/index.html?mock=ok#gallery");
    var t2 = null;
    var id, firstPhone;
    return t.ready.then(function () {
      return uploadOne(t);
    }).then(function (newId) {
      id = newId;
      return googleButton(t);
    }).then(function (button) {
      button.click();
      return signedIn(t);
    }).then(function () {
      t.f.remove();
      firstPhone = localStorage.getItem("gallery-device");
      newPhone();   // another phone, same Google account
      t2 = galleryFrame("/index.html?mock=ok#gallery");
      return t2.ready;
    }).then(function () {
      return googleButton(t2);
    }).then(function (button) {
      ok(localStorage.getItem("gallery-device") !== firstPhone, "not a different phone");
      ok(t2.tileIds().indexOf(id) < 0, "the photo was this phone's before signing in");
      button.click();
      return signedIn(t2);
    }).then(function () {
      return waitFor(function () { return t2.q('[data-id="' + id + '"] [data-g="tile-delete"]'); }, "earlier upload with Delete", PAGE_MS);
    }).then(function (del) {
      ok(shown(del), "Delete not shown");
      return signOut(t2);
    }).then(function () {
      t2.f.remove();
      newPhone();
    }, function (e) { t.f.remove(); if (t2) t2.f.remove(); newPhone(); throw e; });
  }, { timeoutMs: 15000 });

  test("sign-in failure keeps upload working", function () {
    newPhone();
    var t = galleryFrame("/index.html?mock=ok&gis=broken#gallery");
    return t.ready.then(function () {
      t.q('[data-g="tab-mine"]').click();
      return waitFor(function () {
        var box = t.q('[data-g="signin"]');
        return box && box.textContent.indexOf(T().signInUnavailable) >= 0;
      }, "sign-in unavailable on Photos by me", PAGE_MS);
    }).then(function () {
      ok(shown(t.q('[data-g="add"]')), "Add photos missing");
      return openPanel(t);
    }).then(function () {
      ok(shown(t.q('[data-g="panel-upload"]')), "Upload missing");
      ok(shown(t.q('[data-g="name"]')), "name box missing");
      t.q('[data-g="panel"] [data-g="use-google"]').click();
      return waitFor(function () {
        var box = t.q('[data-g="panel"] [data-g="signin"]');
        return box && box.textContent.indexOf(T().signInUnavailable) >= 0;
      }, "sign-in unavailable in the panel");
    }).then(function () {
      ok(!t.q('[data-g="panel-upload"]').disabled, "Upload still works");
      t.q('[data-g="panel-close"]').click();
      t.f.remove();
    }, function (e) { t.f.remove(); throw e; });
  }, { timeoutMs: 15000 });

  test("hidden without client id", function () {
    newPhone();
    var t = galleryFrame("/index.html?mock=ok&noclient=1#gallery");
    return t.ready.then(function () {
      t.q('[data-g="tab-mine"]').click();
      return waitFor(function () { return t.q('[data-g="state"]') && t.q('[data-g="subtitle"]').textContent === T().mineSubtitle; },
        "Photos by me", PAGE_MS);
    }).then(function () {
      return wait(300);
    }).then(function () {
      eq(t.q('[data-g="signin"]'), null, "sign-in shown");
      eq(t.q('[data-g="signin-card"]'), null, "sign-in card shown");
      return openPanel(t);
    }).then(function () {
      eq(t.q('[data-g="use-google"]'), null, "Google link shown");
      ok(!gisLoaded(t), "Google script loaded");
      t.q('[data-g="panel-close"]').click();
      t.f.remove();
    }, function (e) { t.f.remove(); throw e; });
  }, { timeoutMs: 15000 });

  test("sign-out failure keeps you signed in", function () {
    // mock=nounlink: the stand-in answers unlink with an error page.
    newPhone();
    var t = galleryFrame("/index.html?mock=nounlink#gallery");
    return t.ready.then(function () {
      return googleButton(t);
    }).then(function (button) {
      button.click();
      return signedIn(t);
    }).then(function () {
      t.q('[data-g="signout"]').click();
      return waitFor(function () { return shown(t.q('[data-g="signout-failed"]')); }, "sign-out failure message", 9000);
    }).then(function () {
      eq(t.q('[data-g="signout-failed"]').textContent, T().signOutFailed);
      ok(shown(t.q('[data-g="signed-in"]')), "card no longer says signed in");
      ok(!t.q('[data-g="signout"]').disabled, "Sign out not usable again");
      ok(localStorage.getItem("gallery-account").indexOf("Ravi Kumar") >= 0, "phone forgot the account");
      return openPanel(t);
    }).then(function () {
      ok(!shown(t.q('[data-g="name"]')), "name box shown while still signed in");
      t.q('[data-g="panel-close"]').click();
      t.f.remove();
      newPhone();
    }, function (e) { t.f.remove(); newPhone(); throw e; });
  }, { timeoutMs: 15000 });

  test("the server decides who is signed in", function () {
    newPhone();
    // The phone thinks it is signed in, the server doesn't know it: signed out everywhere.
    localStorage.setItem("gallery-account", JSON.stringify({ name: "Old Name" }));
    var t = galleryFrame("/index.html?mock=ok#gallery");
    var t2 = null;
    return t.ready.then(function () {
      // The photos saved on the phone show first; the server's answer follows.
      return waitFor(function () { return localStorage.getItem("gallery-account") === "null"; },
        "phone told it's signed out", PAGE_MS);
    }).then(function () {
      return openPanel(t);
    }).then(function () {
      ok(shown(t.q('[data-g="name"]')), "name box missing");
      t.q('[data-g="panel-close"]').click();
      return googleButton(t);
    }).then(function (button) {
      button.click();
      return signedIn(t);
    }).then(function () {
      t.f.remove();
      // The server links this phone, the phone forgot: signed in everywhere.
      localStorage.removeItem("gallery-account");
      t2 = galleryFrame("/index.html?mock=ok#gallery");
      return t2.ready;
    }).then(function () {
      t2.q('[data-g="tab-mine"]').click();
      return signedIn(t2);
    }).then(function () {
      return openPanel(t2);
    }).then(function () {
      ok(!shown(t2.q('[data-g="name"]')), "name box shown though the server says signed in");
      t2.q('[data-g="panel-close"]').click();
      return signOut(t2);
    }).then(function () {
      t2.f.remove();
      newPhone();
    }, function (e) { t.f.remove(); if (t2) t2.f.remove(); newPhone(); throw e; });
  }, { timeoutMs: 15000 });
})();
