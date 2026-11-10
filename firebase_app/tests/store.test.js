// Tests for gallery/store.js (photo list, paging, saved list, hearts). Fake api objects.
(function () {
  "use strict";

  var G = function () { return self.WeddingGallery; };
  var CFG = function () { return Object.assign({}, self.SITE_CONFIG.gallery, { pageSize: 30, savedListSize: 60 }); };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fakeStorage() {
    var data = {};
    return {
      data: data,
      get: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      set: function (k, v) { data[k] = String(v); },
    };
  }

  function photo(id, over) {
    return Object.assign({ id: id, by: "", at: 1000, hearts: 0, hearted: false, mine: false }, over || {});
  }
  function photos(n, from) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(photo("p" + (from + i), { at: 100000 - (from + i) }));
    return out;
  }
  function listOk(ps, next, total) {
    return { ok: true, photos: ps, next: next == null ? null : next, total: total == null ? ps.length : total,
      uploadsOpen: true, full: false, account: null };
  }
  function unavailable() { throw new (G().errors.GalleryError)("unavailable", "test"); }

  // handlers: { list(payload, n), heart(payload, n), delete(payload, n) } -> body | Promise<body>; may throw.
  function fakeApi(handlers) {
    var calls = [];
    return {
      calls: calls,
      call: function (action, payload) {
        calls.push([action, payload]);
        return Promise.resolve().then(function () { return handlers[action](payload, calls.length); });
      },
      count: function (action) { return calls.filter(function (c) { return c[0] === action; }); },
    };
  }

  function make(api, st) {
    st = st || fakeStorage();
    var identity = G().identity.create({ storageGet: st.get, storageSet: st.set });
    return G().store.create({ api: api, identity: identity, cfg: CFG(), storageGet: st.get, storageSet: st.set });
  }

  function find(s, id) { return s.state.photos.filter(function (p) { return p.id === id; })[0]; }

  test("load fills first page", async function () {
    var api = fakeApi({ list: function () { return listOk(photos(30, 0), "30", 45); } });
    var s = make(api);
    await s.load("all");
    eq(s.state.photos.length, 30);
    eq(s.state.status, "ready");
    eq(s.state.total, 45);
    eq(s.state.next, "30");
    eq(api.calls[0][1].limit, 30);
    ok(/^[0-9a-f]{32}$/.test(api.calls[0][1].device), "device code sent");
  });

  test("loadMore appends and stops", async function () {
    var api = fakeApi({ list: function (p) {
      return p.cursor ? listOk(photos(15, 30), null, 45) : listOk(photos(30, 0), "30", 45);
    } });
    var s = make(api);
    await s.load("all");
    await s.loadMore();
    eq(s.state.photos.length, 45);
    eq(api.calls[1][1].cursor, "30");
    var n = api.calls.length;
    await s.loadMore();
    eq(api.calls.length, n, "no call once next is null");
  });

  test("failure falls back to saved list", async function () {
    var st = fakeStorage();
    var s1 = make(fakeApi({ list: function () { return listOk(photos(30, 0), "30", 45); } }), st);
    await s1.load("all");
    var s2 = make(fakeApi({ list: unavailable }), st);
    await s2.load("all");
    eq(s2.state.fromSaved, true);
    eq(s2.state.status, "ready");
    eq(s2.state.error, "unavailable");
    eq(s2.state.photos.map(function (p) { return p.id; }), s1.state.photos.map(function (p) { return p.id; }));
  });

  test("failure with nothing saved", async function () {
    var s = make(fakeApi({ list: unavailable }));
    await s.load("all");
    eq(s.state.status, "error");
    eq(s.state.error, "unavailable");
    eq(s.state.photos.length, 0);
  });

  test("subscribers hear about changes", async function () {
    var s = make(fakeApi({ list: function () { return listOk(photos(2, 0)); } }));
    var seen = [];
    var off = s.subscribe(function (st) { seen.push(st.status); });
    await s.load("all");
    off();
    await s.load("all");
    eq(seen, ["loading", "ready"]);
  });

  test("rapid heart taps settle on last state", async function () {
    var api = fakeApi({
      list: function () { return listOk([photo("a", { hearts: 5 })]); },
      heart: function (p) {
        return new Promise(function (r) {
          setTimeout(function () { r({ ok: true, hearts: p.on ? 6 : 5, hearted: p.on }); }, 30);
        });
      },
    });
    var s = make(api);
    await s.load("all");
    s.toggleHeart("a"); s.toggleHeart("a"); s.toggleHeart("a");
    eq(find(s, "a").hearted, true, "shown at once");
    await wait(200);
    eq(find(s, "a").hearted, true);
    eq(find(s, "a").hearts, 6);
    var hc = api.count("heart");
    ok(hc.length >= 1, "heart sent");
    ok(hc.filter(function (c) { return c[1].on === true; }).length <= 2, "too many on:true calls");
    eq(hc[hc.length - 1][1].on, true);
  });

  test("heart tapped twice while sending ends unhearted", async function () {
    var api = fakeApi({
      list: function () { return listOk([photo("a", { hearts: 5 })]); },
      heart: function (p) {
        return new Promise(function (r) {
          setTimeout(function () { r({ ok: true, hearts: p.on ? 6 : 5, hearted: p.on }); }, 30);
        });
      },
    });
    var s = make(api);
    await s.load("all");
    s.toggleHeart("a"); s.toggleHeart("a");
    eq(find(s, "a").hearts, 5);
    await wait(200);
    eq(find(s, "a").hearted, false);
    eq(find(s, "a").hearts, 5);
    var hc = api.count("heart");
    eq(hc[hc.length - 1][1].on, false, "server told the last state");
  });

  test("heart failure is kept and flushed", async function () {
    var st = fakeStorage();
    var failing = true;
    var api = fakeApi({
      list: function () { return listOk([photo("a", { hearts: 5 })]); },
      heart: function (p) {
        if (failing) unavailable();
        return { ok: true, hearts: p.on ? 6 : 5, hearted: p.on };
      },
    });
    var s = make(api, st);
    await s.load("all");
    s.toggleHeart("a");
    await wait(30);
    eq(find(s, "a").hearted, true, "optimistic state kept");
    eq(find(s, "a").hearts, 6);
    eq(JSON.parse(st.data["gallery-pending-hearts"]), { a: true });
    failing = false;
    var before = api.count("heart").length;
    await s.refresh();
    await wait(30);
    var hc = api.count("heart");
    ok(hc.length > before, "pending heart sent after refresh");
    eq(hc[hc.length - 1][1], { device: hc[hc.length - 1][1].device, id: "a", on: true });
    eq(JSON.parse(st.data["gallery-pending-hearts"] || "{}"), {});
    eq(find(s, "a").hearted, true);
    eq(find(s, "a").hearts, 6);
  });

  test("stale list answer does not undo a confirmed heart", async function () {
    var release = null;
    var n = 0;
    var api = fakeApi({
      list: function () {
        n++;
        if (n === 1) return listOk([photo("a", { hearts: 5 })]);
        if (n === 2) {   // left before the heart was applied; answers late with the old state
          return new Promise(function (r) { release = function () { r(listOk([photo("a", { hearts: 5 })])); }; });
        }
        return listOk([photo("a", { hearts: 5, hearted: false })]);   // asked after: trusted
      },
      heart: function () { return { ok: true, hearts: 6, hearted: true }; },
    });
    var s = make(api);
    await s.load("all");
    var pending = s.refresh();
    await wait(0);
    s.toggleHeart("a");
    await wait(20);
    eq(api.count("heart").length, 1, "heart confirmed first");
    ok(release, "refresh still waiting");
    release();
    await pending;
    eq(find(s, "a").hearted, true, "stale list undid the heart");
    eq(find(s, "a").hearts, 6);
    await s.refresh();
    eq(find(s, "a").hearted, false, "a list asked for later is trusted");
    eq(find(s, "a").hearts, 5);
  });

  test("pending heart from an earlier visit is sent on load", async function () {
    var st = fakeStorage();
    st.data["gallery-pending-hearts"] = JSON.stringify({ a: true });
    var api = fakeApi({
      list: function () { return listOk([photo("a", { hearts: 5 })]); },
      heart: function (p) { return { ok: true, hearts: 6, hearted: true }; },
    });
    var s = make(api, st);
    await s.load("all");
    await wait(30);
    eq(api.count("heart").length, 1);
    eq(JSON.parse(st.data["gallery-pending-hearts"]), {});
    eq(find(s, "a").hearts, 6);
  });

  test("count never negative", async function () {
    var api = fakeApi({
      list: function () { return listOk([photo("a", { hearts: 0, hearted: true })]); },
      heart: function () { return new Promise(function () {}); },  // never answers
    });
    var s = make(api);
    await s.load("all");
    s.toggleHeart("a");
    eq(find(s, "a").hearted, false);
    eq(find(s, "a").hearts, 0);
  });

  test("refresh prepends new photos without reordering", async function () {
    var first = photos(30, 0);
    var api = fakeApi({ list: function (p, n) {
      if (n === 1) return listOk(first, "30", 45);
      return listOk([photo("new1", { at: 200001 }), photo("new2", { at: 200000 })]
        .concat(first.slice(0, 28).map(function (p, i) { return i === 3 ? photo(p.id, { at: p.at, hearts: 9 }) : p; })), "30", 47);
    } });
    var s = make(api);
    await s.load("all");
    await s.refresh();
    var ids = s.state.photos.map(function (p) { return p.id; });
    eq(ids.slice(0, 3), ["new1", "new2", "p0"]);
    eq(ids.length, 32);
    eq(ids.slice(2), first.map(function (p) { return p.id; }));
    eq(find(s, "p3").hearts, 9, "existing photo updated");
    eq(s.state.total, 47);
  });

  test("refresh failure keeps what is shown", async function () {
    var n = 0;
    var api = fakeApi({ list: function () { if (++n > 1) unavailable(); return listOk(photos(3, 0)); } });
    var s = make(api);
    await s.load("all");
    await s.refresh();
    eq(s.state.status, "ready");
    eq(s.state.photos.length, 3);
    eq(s.state.error, null);
  });

  test("mine tab asks for mine", async function () {
    var api = fakeApi({ list: function (p) { return listOk(p.mine ? [photo("m", { mine: true })] : photos(3, 0)); } });
    var s = make(api);
    await s.load("all");
    await s.load("mine");
    eq(s.state.tab, "mine");
    eq(api.calls[1][1].mine, true);
    eq(s.state.photos.map(function (p) { return p.id; }), ["m"]);
  });

  test("insert remove and flags", async function () {
    var s = make(fakeApi({ list: function () { return listOk(photos(2, 0)); } }));
    await s.load("all");
    s.insert(photo("up", { mine: true }));
    eq(s.state.photos[0].id, "up");
    eq(s.state.total, 3);
    s.remove("p0");
    eq(s.state.photos.map(function (p) { return p.id; }), ["up", "p1"]);
    eq(s.state.total, 2);
    s.setFlags({ uploadsOpen: false, full: true });
    eq([s.state.uploadsOpen, s.state.full], [false, true]);
  });

  /* ---------- delete (the Remove / Keep question is asked by gallery.js first) ---------- */

  test("delete removes from both tabs", async function () {
    var st = fakeStorage();
    var deleted = {};
    var listFails = false;
    var api = fakeApi({
      list: function (p) {
        if (listFails) unavailable();
        var all = [photo("m1", { mine: true }), photo("a"), photo("m2", { mine: true })]
          .filter(function (x) { return !deleted[x.id]; });
        return listOk(p.mine ? all.filter(function (x) { return x.mine; }) : all);
      },
      heart: unavailable,
      delete: function (p) { deleted[p.id] = true; return { ok: true }; },
    });
    var s = make(api, st);
    await s.load("all");
    s.toggleHeart("m1");                 // fails: kept as pending
    await wait(30);
    eq(JSON.parse(st.data["gallery-pending-hearts"]), { m1: true });
    await s.load("mine");
    eq(s.state.photos.map(function (p) { return p.id; }), ["m1", "m2"]);
    var done = s.deletePhoto("m1");
    eq(s.state.deleting, ["m1"], "marked while sending");
    var out = await done;
    eq(out, undefined);
    var dc = api.count("delete");
    eq(dc.length, 1);
    eq(dc[0][1], { device: api.calls[0][1].device, id: "m1" });
    eq(s.state.photos.map(function (p) { return p.id; }), ["m2"], "gone from Photos by me");
    eq(s.state.total, 1);
    eq(s.state.deleting, []);
    eq(s.state.deleteError, null);
    eq(JSON.parse(st.data["gallery-pending-hearts"]), {}, "its pending heart dropped");
    var saved = JSON.parse(st.data["gallery-saved"]);
    eq(saved.photos.map(function (p) { return p.id; }), ["a", "m2"], "gone from the saved All photos list");
    eq(saved.total, 2);
    listFails = true;                    // offline: All photos comes from the saved list
    await s.load("all");
    eq(s.state.fromSaved, true);
    eq(s.state.photos.map(function (p) { return p.id; }), ["a", "m2"], "gone from All photos");
  });

  test("delete failure keeps photo", async function () {
    var api = fakeApi({
      list: function () { return listOk([photo("m1", { mine: true }), photo("m2", { mine: true })]); },
      delete: unavailable,
    });
    var s = make(api);
    await s.load("mine");
    await s.deletePhoto("m1");
    eq(s.state.photos.map(function (p) { return p.id; }), ["m1", "m2"], "photo stays");
    eq(s.state.total, 2);
    eq(s.state.deleteError, { id: "m1", code: "unavailable" });
    eq(s.state.deleting, [], "nothing left spinning");
    eq(s.state.error, null, "the list itself is fine");
    api.calls.length = 0;
    var again = s.deletePhoto("m1");
    eq(s.state.deleteError, null, "a new try clears the old line");
    await again;
    await s.load("mine");
    eq(s.state.deleteError, null, "switching or reloading clears it too");
  });

  test("delete tapped twice is sent once", async function () {
    var release = null;
    var api = fakeApi({
      list: function () { return listOk([photo("m1", { mine: true })]); },
      delete: function () { return new Promise(function (r) { release = function () { r({ ok: true }); }; }); },
    });
    var s = make(api);
    await s.load("mine");
    var a = s.deletePhoto("m1");
    var b = s.deletePhoto("m1");
    await wait(10);
    eq(api.count("delete").length, 1);
    release();
    await Promise.all([a, b]);
    eq(s.state.photos.length, 0);
    eq(s.state.total, 0);
  });

  test("a list sent before the delete does not bring the photo back", async function () {
    var release = null;
    var n = 0;
    var api = fakeApi({
      list: function () {
        n++;
        var ps = [photo("m1", { mine: true }), photo("a")];
        if (n === 2) return new Promise(function (r) { release = function () { r(listOk(ps)); }; });
        return listOk(ps);
      },
      delete: function () { return { ok: true }; },
    });
    var s = make(api);
    await s.load("all");
    var pending = s.refresh();
    await wait(0);
    await s.deletePhoto("m1");
    ok(release, "refresh still waiting");
    release();
    await pending;
    eq(s.state.photos.map(function (p) { return p.id; }), ["a"]);
    eq(s.state.total, 1, "total not counted with the deleted photo");
    s.insert(photo("m1", { mine: true }));
    eq(s.state.photos.map(function (p) { return p.id; }), ["a"], "not re-added");
  });

  test("list answers set the phone's account", async function () {
    var st = fakeStorage();
    var answer = null;
    var api = fakeApi({ list: function () { return Object.assign(listOk(photos(2, 0)), { account: answer }); } });
    var identity = G().identity.create({ storageGet: st.get, storageSet: st.set });
    identity.setAccount({ name: "Ravi" });
    var s = G().store.create({ api: api, identity: identity, cfg: CFG(), storageGet: st.get, storageSet: st.set });
    eq(s.state.account, { name: "Ravi" }, "starts from the phone's");
    await s.load("all");
    eq(identity.account(), null, "server says not linked: phone forgets");
    eq(s.state.account, null);
    answer = { name: "Asha" };
    await s.refresh();
    eq(identity.account(), { name: "Asha" }, "server says linked: phone knows");
    api.call = function () { return Promise.reject(new (G().errors.GalleryError)("offline")); };
    await s.refresh();
    eq(identity.account(), { name: "Asha" }, "a failed list changes nothing");
  });
})();
