// Tests for gallery/view-panel.js (Ready-to-share panel and the Remove/Keep dialog).
(function () {
  "use strict";

  var G = function () { return self.WeddingGallery; };
  var T = function () { return self.SITE_CONFIG.text.gallery; };

  function waitFor(fn, what) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function poll() {
        var v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start > 3500) return reject(new Error("timed out waiting for " + what));
        setTimeout(poll, 20);
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

  function fakeStorage() {
    var data = {};
    return {
      get: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      set: function (k, v) { data[k] = String(v); },
    };
  }

  function make(over) {
    over = over || {};
    var st = fakeStorage();
    var identity = G().identity.create({ storageGet: st.get, storageSet: st.set });
    if (over.name) identity.setName(over.name);
    if (over.account) identity.setAccount(over.account);
    var C = self.SITE_CONFIG;
    var cfg = Object.assign({}, C, { gallery: Object.assign({}, C.gallery, over.gallery || {}) });
    var ctx = { cfg: cfg, text: C.text.gallery, h: h, icon: icon, fill: fill, locale: C.locale };
    var sent = [];
    var mounted = [];
    var panel = G().viewPanel.create({ ctx: ctx, identity: identity,
      signIn: { mountButton: function (el) { mounted.push(el); } },
      onUpload: function (files, name) { sent.push([files, name]); } });
    document.body.append(panel.el);
    return { panel: panel, sent: sent, el: panel.el, identity: identity, mounted: mounted,
      q: function (s) { return panel.el.querySelector('[data-g="' + s + '"]'); },
      all: function (s) { return panel.el.querySelectorAll('[data-g="' + s + '"]'); },
      done: function () { panel.close(); panel.el.remove(); } };
  }

  function files(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(new File(["x" + i], "p" + i + ".jpg", { type: "image/jpeg" }));
    return out;
  }

  function shown(el) { return !!el && el.getClientRects().length > 0; }   // fixed parts have no offsetParent

  test("name prefilled", function () {
    var p = make({ name: "Ravi uncle" });
    p.panel.open(files(3));
    var name = p.q("name");
    var value = name && name.value;
    var hint = p.el.textContent;
    var ok1 = shown(p.q("panel"));
    p.done();
    ok(ok1, "panel not shown");
    eq(value, "Ravi uncle");
    ok(hint.indexOf(fill(T().nameHint, { name: "Ravi uncle" })) >= 0, "hint missing");
  });

  test("remove one", function () {
    var p = make();
    p.panel.open(files(3));
    var before = p.all("panel-thumb").length;
    p.all("panel-remove")[0].click();
    var after = p.all("panel-thumb").length;
    var more = p.q("panel-more");
    p.done();
    eq([before, after], [3, 2]);
    ok(more, "More tile missing");
  });

  test("upload emits files and name", function () {
    var p = make({ name: "Ravi" });
    var picked = files(3);
    p.panel.open(picked);
    p.all("panel-remove")[1].click();
    p.q("name").value = "  Asha  ";
    p.q("name").dispatchEvent(new Event("input"));
    p.q("panel-upload").click();
    var closed = !shown(p.q("panel"));
    p.done();
    eq(p.sent.length, 1);
    eq(p.sent[0][0].map(function (f) { return f.name; }), ["p0.jpg", "p2.jpg"]);
    ok(p.sent[0][0][0] === picked[0], "not the picked File objects");
    eq(p.sent[0][1], "Asha");
    ok(closed, "panel still open");
  });

  test("name hidden when signed in", function () {
    var p = make({ account: { name: "Asha G" } });
    p.panel.open(files(1));
    var name = p.q("name");
    var google = p.q("use-google");
    p.done();
    ok(!shown(name), "name box shown");
    ok(!shown(google), "Google link shown when already signed in");
  });

  test("google link only with a client id", function () {
    var a = make({ gallery: { googleClientId: "abc" } });
    a.panel.open(files(1));
    var withId = shown(a.q("use-google"));
    a.done();
    var b = make({ gallery: { googleClientId: "" } });
    b.panel.open(files(1));
    var without = shown(b.q("use-google"));
    b.done();
    eq([withId, without], [true, false]);
  });

  test("picked photos past the limit are noted", function () {
    var p = make({ gallery: { maxPhotosPerUpload: 2 } });
    p.panel.open(files(3));
    var thumbs = p.all("panel-thumb").length;
    var text = p.el.textContent;
    p.done();
    eq(thumbs, 2);
    ok(text.indexOf(fill(T().tooMany, { max: 2 })) >= 0, "tooMany missing");
  });

  test("more adds to the list", function () {
    var p = make();
    p.panel.open(files(1));
    var input = p.el.querySelector('input[type="file"]');
    var dt = new DataTransfer();
    files(2).forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    var n = p.all("panel-thumb").length;
    p.done();
    eq(n, 3);
  });

  test("previews appear and are freed", function () {
    var revoked = [];
    var realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = function (u) { revoked.push(u); realRevoke.call(URL, u); };
    var c = document.createElement("canvas");
    c.width = 300;
    c.height = 200;
    c.getContext("2d").fillRect(0, 0, 300, 200);
    var p = make();
    return new Promise(function (r) { c.toBlob(r, "image/jpeg"); }).then(function (blob) {
      p.panel.open([new File([blob], "a.jpg", { type: "image/jpeg" })]);
      return waitFor(function () { var im = p.el.querySelector('[data-g="panel-thumb"] img'); return im && im.src; }, "preview");
    }).then(function (src) {
      p.done();
      URL.revokeObjectURL = realRevoke;
      ok(src.indexOf("blob:") === 0, "preview is not a blob url");
      ok(revoked.indexOf(src) >= 0, "preview not freed on close");
    }, function (e) { URL.revokeObjectURL = realRevoke; p.done(); throw e; });
  });

  test("confirm resolves", function () {
    var p = make();
    var first = p.panel.confirm(T().confirmTitle);
    var text = p.el.textContent;
    p.q("confirm-remove").click();
    return first.then(function (yes) {
      eq(yes, true);
      ok(text.indexOf(T().confirmTitle) >= 0, "question missing");
      var second = p.panel.confirm(T().confirmTitle);
      p.q("confirm-keep").click();
      return second;
    }).then(function (yes) {
      var gone = !shown(p.q("confirm-remove"));
      p.done();
      eq(yes, false);
      ok(gone, "dialog still shown");
    });
  });

  test("use-google becomes the Google button", function () {
    var p = make({ gallery: { googleClientId: "abc" } });
    p.panel.open(files(1));
    p.q("use-google").click();
    var box = p.q("signin");
    var linkGone = !p.q("use-google");
    var mounted = p.mounted.slice();
    var boxShown = shown(box);
    // Signed in from the panel: the name box goes, so does the sign-in.
    p.identity.setAccount({ name: "Ravi Kumar" });
    p.panel.syncAccount();
    var nameAfter = shown(p.q("name"));
    var signinAfter = shown(p.q("signin"));
    p.done();
    ok(linkGone, "link still there");
    ok(boxShown, "sign-in box not shown");
    eq(mounted.length, 1, "button mounted once");
    ok(mounted[0] === box, "mounted into the sign-in box");
    eq([nameAfter, signinAfter], [false, false]);
  });

  test("signed out again: name box and link come back", function () {
    var p = make({ gallery: { googleClientId: "abc" }, account: { name: "Ravi" } });
    p.panel.open(files(1));
    var before = [shown(p.q("name")), shown(p.q("use-google"))];
    p.identity.setAccount(null);
    p.panel.syncAccount();
    var after = [shown(p.q("name")), shown(p.q("use-google"))];
    p.done();
    eq(before, [false, false]);
    eq(after, [true, true]);
  });

  test("an account without a name keeps the name box", function () {
    var p = make({ gallery: { googleClientId: "abc" }, account: { name: "" }, name: "Asha" });
    p.panel.open(files(1));
    var name = shown(p.q("name"));
    var google = shown(p.q("use-google"));
    p.q("panel-upload").click();
    p.done();
    eq([name, google], [true, false], "name box shown, Google link not (already signed in)");
    eq(p.sent[0][1], "Asha", "typed name sent");
  });
})();
