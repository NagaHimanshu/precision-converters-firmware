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
    var signOuts = [];
    var panel = G().viewPanel.create({ ctx: ctx, identity: identity,
      signIn: { mountButton: function (el) { mounted.push(el); },
        signOut: function () { signOuts.push(1); return over.signOut ? over.signOut(identity, panel) : Promise.resolve(); } },
      onUpload: function (files, name) { sent.push([files, name]); } });
    document.body.append(panel.el);
    return { panel: panel, sent: sent, el: panel.el, identity: identity, mounted: mounted, signOuts: signOuts,
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

  test("Privacy Policy line only under Google's button, as the tiny last line", function () {
    var p = make({ gallery: { googleClientId: "abc" } });
    p.panel.open(files(1));
    var before = p.q("privacy-link");
    p.q("use-google").click();
    var a = p.q("privacy-link");
    var got = shown(a) ? [a.tagName, a.textContent, a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")] : null;
    var line = a && a.parentNode;
    var lineText = line && line.textContent;
    var last = line && line === line.parentNode.lastElementChild && line.parentNode === p.q("panel-upload").parentNode.lastElementChild;
    var below = line && line.getBoundingClientRect().top >= p.q("signin").getBoundingClientRect().bottom - 1;
    var small = line && parseFloat(getComputedStyle(line).fontSize) < parseFloat(getComputedStyle(p.q("panel-upload")).fontSize);
    p.done();
    eq(before, null, "no Privacy link before Google's button is asked for");
    // A new tab: leaving the page would lose the photos just picked.
    eq(got, ["A", T().privacyLink, self.SITE_CONFIG.gallery.privacyUrl, "_blank", "noopener"]);
    eq(T().privacyLink, "Privacy Policy");
    eq(lineText, fill(T().privacyLine, { link: T().privacyLink }));
    ok(last, "not the panel's last line");
    ok(below, "not under Google's button");
    ok(small, "not in smaller letters");
  });

  test("camera tile next to More opens the camera", function () {
    var p = make();
    p.panel.open(files(1));
    var tile = p.q("panel-camera");
    var cam = p.q("camera-input");
    var clicked = 0;
    cam.click = function () { clicked++; };
    var order = [].map.call(p.el.querySelector(".g-p-thumbs").children, function (el) { return el.dataset.g; });
    tile.click();
    var attrs = [cam.type, cam.getAttribute("accept"), cam.getAttribute("capture"), cam.hasAttribute("multiple")];
    // The photo taken comes back into the same panel.
    var dt = new DataTransfer();
    dt.items.add(new File(["c"], "camera.jpg", { type: "image/jpeg" }));
    cam.files = dt.files;
    cam.dispatchEvent(new Event("change"));
    var n = p.all("panel-thumb").length;
    var open = shown(p.q("panel"));
    var label = tile.textContent;
    p.done();
    eq(order, ["panel-thumb", "panel-more", "panel-camera"]);
    eq(clicked, 1, "camera not opened");
    eq(attrs, ["file", "image/*", "environment", false]);
    eq([n, open], [2, true]);
    ok(label.indexOf(T().panelCamera) >= 0, "Camera label missing");
  });

  test("camera tile goes at the limit, like More", function () {
    var p = make({ gallery: { maxPhotosPerUpload: 2 } });
    p.panel.open(files(1));
    var before = [shown(p.q("panel-more")), shown(p.q("panel-camera"))];
    p.panel.open(files(1));
    var after = [shown(p.q("panel-more")), shown(p.q("panel-camera"))];
    p.done();
    eq(before, [true, true]);
    eq(after, [false, false]);
  });

  test("signed in: green Using Google name line instead of the name box", function () {
    var root = document.documentElement.style;
    root.setProperty("--success", self.SITE_CONFIG.theme.colors.success);   // as app.js does from the theme
    var p = make({ gallery: { googleClientId: "abc" }, account: { name: "Asha G" }, name: "Asha" });
    p.panel.open(files(1));
    var line = p.q("using-google");
    var text = line && line.querySelector(".g-p-using-name").textContent;
    var color = line && getComputedStyle(line.querySelector(".g-p-using-name")).color;
    var probe = document.createElement("span");
    probe.style.color = self.SITE_CONFIG.theme.colors.success;
    document.body.append(probe);
    var green = getComputedStyle(probe).color;
    probe.remove();
    root.removeProperty("--success");
    var state = [shown(line), shown(p.q("name")), shown(p.q("not-you")), shown(p.q("use-google"))];
    p.done();
    eq(text, fill(T().usingGoogleName, { name: "Asha G" }));
    ok(text.indexOf("\u2713") >= 0, "no tick");
    eq(state, [true, false, true, false]);
    eq(color, green, "not in the success colour");
  });

  test("Not you? signs out; the name box comes back with the last name", function () {
    var p = make({ gallery: { googleClientId: "abc" }, account: { name: "Asha G" }, name: "Asha",
      signOut: function (identity, panel) {
        identity.setAccount(null);
        panel.syncAccount();
        return Promise.resolve();
      } });
    p.panel.open(files(1));
    p.q("not-you").click();
    // Checked by hidden, not by what is on screen: an earlier test's Back may close the panel meanwhile.
    var off = function (g) { return p.q(g).closest(".g-sheet [hidden]") !== null; };
    return Promise.resolve().then(function () {
      var state = [!off("using-google"), !off("name"), p.q("name").value, !off("use-google")];
      var outs = p.signOuts.length;
      p.done();
      eq(outs, 1);
      eq(state, [false, true, "Asha", true]);
    });
  });

  test("Not you? that fails says so and stays signed in", function () {
    var p = make({ gallery: { googleClientId: "abc" }, account: { name: "Asha G" },
      signOut: function () { return Promise.reject(new Error("offline")); } });
    var warn = console.warn;
    console.warn = function () {};
    p.panel.open(files(1));
    p.q("not-you").click();
    var off = function (g) { return p.q(g).closest(".g-sheet [hidden]") !== null; };
    return waitFor(function () { return !off("panel-signout-failed") && !p.q("not-you").disabled; }, "failure line").then(function () {
      console.warn = warn;
      var state = [!off("using-google"), !off("name"), p.q("panel-signout-failed").textContent, p.q("not-you").disabled];
      p.done();
      eq(state, [true, false, T().signOutFailed, false]);
    }, function (e) { console.warn = warn; p.done(); throw e; });
  });

  test("no sign-in: no green line or Not you", function () {
    var p = make({ gallery: { googleClientId: "" }, account: { name: "Asha G" } });
    p.panel.open(files(1));
    var state = [!!p.q("not-you"), shown(p.q("using-google"))];
    p.done();
    eq(state, [false, true], "the name in use is still said; there is just nothing to sign out with");
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
