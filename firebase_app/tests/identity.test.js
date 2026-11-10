// Tests for gallery/identity.js (device code and remembered name).
(function () {
  "use strict";

  function fakeStorage() {
    var data = {};
    return {
      data: data,
      get: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      set: function (k, v) { data[k] = String(v); },
    };
  }

  function make(st) {
    return WeddingGallery.identity.create({ storageGet: st.get, storageSet: st.set });
  }

  test("device code is stable", function () {
    var st = fakeStorage();
    var a = make(st).device();
    var b = make(st).device();
    ok(/^[0-9a-f]{32}$/.test(a), "not 32 hex: " + a);
    eq(b, a);
    eq(st.data["gallery-device"], a);
  });

  test("device code survives a storage that forgets", function () {
    var id = WeddingGallery.identity.create({ storageGet: function () { return null; }, storageSet: function () {} });
    ok(/^[0-9a-f]{32}$/.test(id.device()));
    eq(id.device(), id.device());
  });

  test("name round trip", function () {
    var st = fakeStorage();
    eq(make(st).name(), "");
    make(st).setName("Ravi uncle");
    eq(make(st).name(), "Ravi uncle");
    eq(st.data["gallery-name"], "Ravi uncle");
  });

  test("account round trip", function () {
    var st = fakeStorage();
    var id = make(st);
    eq(id.account(), null);
    id.setAccount({ name: "Ravi" });
    eq(make(st).account(), { name: "Ravi" });
    id.setAccount(null);
    eq(make(st).account(), null);
    st.data["gallery-account"] = "{not json";
    eq(make(st).account(), null);
  });

  /* ---------- Google sign-in ---------- */

  var GIS_TIMEOUT_MS = 1200;

  function gisScripts(url) {
    return [].filter.call(document.scripts, function (s) { return s.getAttribute("src") === url; }).length;
  }

  // Resolves the GalleryError code loadGoogle rejected with, and how long it took.
  function loadFails(url, timeoutMs) {
    var start = Date.now();
    return WeddingGallery.identity.loadGoogle({ googleScriptUrl: url, scriptLoadTimeoutMs: timeoutMs }).then(function () {
      throw new Error("loadGoogle resolved for " + url);
    }, function (e) {
      ok(e instanceof WeddingGallery.errors.GalleryError, "not a GalleryError: " + e);
      return { code: e.code, ms: Date.now() - start };
    });
  }

  test("loadGoogle fails cleanly", function () {
    return loadFails("/tests/no-such-gis.js", GIS_TIMEOUT_MS).then(function (r) {
      eq(r.code, "signin_failed");
      ok(r.ms <= GIS_TIMEOUT_MS + 500, "took " + r.ms + " ms");
      ok(!self.google, "nothing defined");
    });
  });

  test("loadGoogle gives up on a slow script", function () {
    // The dev server holds this answer back for 2.5 s.
    return loadFails("/dev/hold?ms=2500&gis", 600).then(function (r) {
      eq(r.code, "signin_failed");
      ok(r.ms >= 500 && r.ms <= 600 + 500, "took " + r.ms + " ms");
    });
  });

  test("loadGoogle needs google.accounts.id", function () {
    // The stand-in GIS script defines nothing when asked for gis=broken.
    return loadFails("/tests/fake-gis.js?gis=broken", GIS_TIMEOUT_MS).then(function (r) {
      eq(r.code, "signin_failed");
      ok(!self.google, "fake GIS defined something");
    });
  });

  test("loadGoogle loads once, renderGoogleButton hands over the token", function () {
    var url = "/tests/fake-gis.js?once";
    var I = WeddingGallery.identity;
    var opts = { googleScriptUrl: url, scriptLoadTimeoutMs: GIS_TIMEOUT_MS };
    var el = document.createElement("div");
    var got = [];
    document.body.append(el);
    return Promise.all([I.loadGoogle(opts), I.loadGoogle(opts)]).then(function () {
      eq(gisScripts(url), 1, "script inserted once");
      return I.loadGoogle(opts);
    }).then(function () {
      eq(gisScripts(url), 1, "not inserted again");
      I.renderGoogleButton(el, { clientId: "client-1", onCredential: function (t) { got.push(t); } });
      var fake = self.google.accounts.id.fake;
      eq(fake.initialized.client_id, "client-1");
      eq(fake.rendered.opts, { type: "standard", shape: "pill", text: "signin_with", size: "large" });
      ok(fake.rendered.el === el, "rendered into the given element");
      el.querySelector("button").click();
      eq(got, ["mock:Ravi Kumar"]);
    }).finally(function () {
      el.remove();
      delete self.google;   // later tests expect no Google script on this page
    });
  });

  // A fake api (answers by action) and store, recording what identity asks of them.
  function signInParts(answers) {
    var st = fakeStorage();
    var calls = [];
    var api = {
      call: function (action, payload) {
        calls.push([action, payload]);
        var a = answers[action];
        return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
      },
    };
    var store = {
      state: { tab: "mine" },
      setFlags: function (f) { calls.push(["setFlags", f]); },
      load: function (tab) { calls.push(["load", tab]); return Promise.resolve(); },
    };
    var id = WeddingGallery.identity.create({ storageGet: st.get, storageSet: st.set, api: api,
      getStore: function () { return store; } });
    return { st: st, calls: calls, id: id };
  }

  test("signIn links this phone", function () {
    var p = signInParts({ link: { ok: true, account: { name: "Ravi Kumar" }, linked: 2 } });
    var device = p.id.device();
    return p.id.signIn("tok-1").then(function (account) {
      eq(account, { name: "Ravi Kumar" });
      eq(p.id.account(), { name: "Ravi Kumar" });
      eq(p.calls, [
        ["link", { device: device, idToken: "tok-1" }],
        ["setFlags", { account: { name: "Ravi Kumar" } }],
        ["load", "mine"],
      ]);
    });
  });

  test("signIn failure stays signed out", function () {
    var GalleryError = WeddingGallery.errors.GalleryError;
    var p = signInParts({ link: new GalleryError("signin_failed") });
    return p.id.signIn("bad").then(function () {
      throw new Error("signIn resolved");
    }, function (e) {
      eq(e.code, "signin_failed");
      eq(p.id.account(), null);
      eq(p.calls.map(function (c) { return c[0]; }), ["link"], "store untouched");
    });
  });

  test("signOut clears once unlinked", function () {
    var p = signInParts({ unlink: { ok: true } });
    p.id.setAccount({ name: "Ravi" });
    var device = p.id.device();
    return p.id.signOut().then(function () {
      eq(p.id.account(), null);
      eq(p.calls, [["unlink", { device: device }], ["setFlags", { account: null }], ["load", "mine"]]);
    });
  });

  test("signOut failure keeps you signed in", function () {
    // The server would still treat this phone as the account: saying "signed out" would be untrue.
    var GalleryError = WeddingGallery.errors.GalleryError;
    var p = signInParts({ unlink: new GalleryError("offline") });
    p.id.setAccount({ name: "Ravi" });
    return p.id.signOut().then(function () {
      throw new Error("signOut resolved");
    }, function (e) {
      eq(e.code, "offline");
      eq(p.id.account(), { name: "Ravi" });
      eq(p.calls.map(function (c) { return c[0]; }), ["unlink"], "store untouched");
    });
  });
})();
