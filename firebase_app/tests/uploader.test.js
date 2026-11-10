// Tests for gallery/uploader.js (upload queue). Fake api, image and store; the last
// test drives the real site in an iframe on the slow stand-in upload.
(function () {
  "use strict";

  var G = function () { return self.WeddingGallery; };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(fn, what, ms) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function poll() {
        var v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start > (ms || 3500)) return reject(new Error("timed out waiting for " + what));
        setTimeout(poll, 20);
      })();
    });
  }

  function fail(code) { return new (G().errors.GalleryError)(code, "test"); }

  function files(n, type) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(new File(["x" + i], "p" + i + ".jpg", { type: type || "image/jpeg" }));
    return out;
  }

  // toJpeg takes `delayMs` and records how many run at once; size = blob size returned.
  function fakeImage(delayMs, size) {
    var im = { now: 0, max: 0, calls: 0 };
    im.toJpeg = function () {
      im.calls++;
      im.now++;
      im.max = Math.max(im.max, im.now);
      return wait(delayMs || 0).then(function () {
        im.now--;
        return { blob: new Blob([new Uint8Array(size || 10)], { type: "image/jpeg" }), width: 10, height: 10 };
      });
    };
    im.toBase64 = function () { return Promise.resolve("/9j/"); };
    return im;
  }

  // upload(payload, n) -> photo | throws; n = 1 for the first upload call.
  function fakeApi(upload, delayMs) {
    var api = { uploads: 0, now: 0, max: 0, payloads: [] };
    api.call = function (action, payload) {
      if (action !== "upload") return Promise.reject(fail("invalid"));
      var n = ++api.uploads;
      api.payloads.push(payload);
      api.now++;
      api.max = Math.max(api.max, api.now);
      return wait(delayMs || 0).then(function () {
        api.now--;
        return { ok: true, photo: upload(payload, n) };
      }, function (e) { api.now--; throw e; }).catch(function (e) { throw e; });
    };
    return api;
  }

  function okUpload(payload, n) {
    return { id: "new" + n, by: payload.name, at: 1, hearts: 0, hearted: false, mine: true };
  }

  function fakeStore() {
    return {
      inserted: [], flags: [],
      insert: function (p) { this.inserted.push(p.id); },
      setFlags: function (f) { this.flags.push(f); },
    };
  }

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
    var parts = {
      api: over.api || fakeApi(okUpload),
      image: over.image || fakeImage(),
      store: fakeStore(),
      identity: identity,
      cfg: Object.assign({}, self.SITE_CONFIG.gallery, { maxPhotosPerUpload: 20, parallelUploads: 2 }, over.cfg || {}),
      changes: 0,
    };
    parts.u = G().uploader.create({ api: parts.api, identity: identity, image: parts.image, cfg: parts.cfg,
      store: parts.store, onChange: function () { parts.changes++; } });
    return parts;
  }

  function idle(u) {
    return waitFor(function () { return !u.busy(); }, "uploads to finish");
  }

  function statuses(u) {
    return u.items().map(function (i) { return i.status + (i.code ? ":" + i.code : ""); });
  }

  test("accepts at most max", function () {
    var p = make({ api: fakeApi(okUpload, 50) });
    eq(p.u.add(files(25), ""), { accepted: 20, dropped: 5 });
    return idle(p.u).then(function () { eq(p.store.inserted.length, 20); });
  });

  test("drops non-images", function () {
    var p = make();
    eq(p.u.add(files(2).concat(files(1, "video/mp4")), ""), { accepted: 2, dropped: 1 });
    return idle(p.u);
  });

  test("uploader remembers the name", function () {
    var p = make();
    p.u.add(files(1), "Ravi uncle");
    eq(p.identity.name(), "Ravi uncle");
    return idle(p.u).then(function () { eq(p.api.payloads[0].name, "Ravi uncle"); });
  });

  test("uploader remembers the name for an account without one", function () {
    var p = make();
    p.identity.setAccount({ name: "" });
    p.u.add(files(1), "Asha");
    eq(p.identity.name(), "Asha");
    p.identity.setAccount({ name: "Ravi Kumar" });
    p.u.add(files(1), "ignored");
    eq(p.identity.name(), "Asha", "a named account's uploads don't change it");
    return idle(p.u);
  });

  test("uploader prepares one photo at a time", function () {
    var p = make({ image: fakeImage(20) });
    p.u.add(files(6), "");
    return idle(p.u).then(function () {
      eq(p.image.calls, 6);
      eq(p.image.max, 1);
    });
  });

  test("uploads run in parallel up to limit", function () {
    var p = make({ api: fakeApi(okUpload, 40), cfg: { parallelUploads: 2 } });
    p.u.add(files(6), "");
    return idle(p.u).then(function () {
      eq(p.api.max, 2);
    });
  });

  test("one failure does not stop others", function () {
    var p = make({ api: fakeApi(function (payload, n) {
      if (n === 2) throw fail("unavailable");
      return okUpload(payload, n);
    }), cfg: { parallelUploads: 1 } });
    p.u.add(files(3), "");
    return idle(p.u).then(function () {
      eq(statuses(p.u), ["done", "failed:unavailable", "done"]);
      p.u.retry(p.u.items()[1].key);
      ok(p.u.busy(), "retry did not start");
      return idle(p.u);
    }).then(function () {
      eq(statuses(p.u), ["done"]);   // a new round starts with only the retried photo
      eq(p.store.inserted, ["new1", "new3", "new4"]);
    });
  });

  test("full stops the rest", function () {
    var p = make({ api: fakeApi(function () { throw fail("full"); }), cfg: { parallelUploads: 1 } });
    p.u.add(files(4), "");
    return idle(p.u).then(function () {
      eq(statuses(p.u), ["failed:full", "failed:full", "failed:full", "failed:full"]);
      eq(p.store.flags, [{ full: true }]);
      eq(p.api.uploads, 1);
    });
  });

  test("paused stops the rest", function () {
    var p = make({ api: fakeApi(function () { throw fail("paused"); }), cfg: { parallelUploads: 1 } });
    p.u.add(files(2), "");
    return idle(p.u).then(function () {
      eq(statuses(p.u), ["failed:paused", "failed:paused"]);
      eq(p.store.flags, [{ uploadsOpen: false }]);
    });
  });

  test("too large is not sent", function () {
    var cfg = self.SITE_CONFIG.gallery;
    var p = make({ image: fakeImage(0, cfg.maxUploadBytes + 1) });
    p.u.add(files(1), "");
    return idle(p.u).then(function () {
      eq(statuses(p.u), ["failed:too_large"]);
      eq(p.api.uploads, 0);
    });
  });

  test("unreadable photo fails alone", function () {
    var image = fakeImage();
    var real = image.toJpeg;
    image.toJpeg = function (file) {
      return file.name === "p0.jpg" ? Promise.reject(fail("unsupported")) : real(file);
    };
    var p = make({ image: image });
    p.u.add(files(2), "");
    return idle(p.u).then(function () {
      eq(statuses(p.u), ["failed:unsupported", "done"]);
      eq(p.store.inserted, ["new1"]);
    });
  });

  test("counts follow the round", function () {
    var p = make({ api: fakeApi(okUpload, 30), cfg: { parallelUploads: 1 } });
    p.u.add(files(3), "");
    var c0 = p.u.counts();
    return waitFor(function () { return p.u.counts().finished === 1; }, "first done").then(function () {
      eq(c0, { finished: 0, total: 3, dropped: 0 });
      ok(p.changes > 0, "onChange never called");
      return idle(p.u);
    });
  });

  // A shared photo's small copy stays (for its grid tile) until the grid says the real
  // picture has loaded; only then is it freed.
  test("uploaded photo keeps its small copy until the real picture shows", function () {
    var image = fakeImage();
    var real = image.toJpeg;
    image.toJpeg = function (file) {
      return real(file).then(function (r) { return Object.assign(r, { preview: new Blob(["small"], { type: "image/jpeg" }) }); });
    };
    var p = make({ image: image });
    var atInsert = [];
    var insert = p.store.insert;
    p.store.insert = function (photo) { atInsert.push(p.u.preview(photo.id)); insert.call(this, photo); };
    p.u.add(files(1), "");
    var url;
    return idle(p.u).then(function () {
      url = p.u.preview("new1");
      ok(/^blob:/.test(url), "small copy kept after upload: " + url);
      eq(atInsert, [url], "small copy known when the photo reaches the list");
      return fetch(url).then(function (r) { return r.text(); });
    }).then(function (body) {
      eq(body, "small", "small copy not freed yet");
      p.u.previewDone("new1");
      eq(p.u.preview("new1"), null, "forgotten once shown");
      return fetch(url).then(function () { return "still there"; }, function () { return "freed"; });
    }).then(function (after) {
      eq(after, "freed");
    });
  });

  /* ---------- the real site ---------- */

  function jpegFile(win) {
    var c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    var g = c.getContext("2d");
    g.fillStyle = "#c97b63";
    g.fillRect(0, 0, 640, 480);
    return new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.8); }).then(function (blob) {
      return new win.File([blob], "photo.jpg", { type: "image/jpeg" });
    });
  }

  // In frame f (Gallery shown): picks `file` like a guest and taps Upload.
  function pickAndUpload(f, file) {
    var q = function (sel) { return f.contentDocument.querySelector("#gallery-body " + sel); };
    q('[data-g="add"]').click();
    var dt = new f.contentWindow.DataTransfer();
    dt.items.add(file);
    var input = q('input[type="file"]');
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return waitFor(function () { var p = q('[data-g="panel"]'); return p && !p.hidden && q('[data-g="panel-upload"]'); }, "panel")
      .then(function (upload) { upload.click(); });
  }

  function inView(win, el) {
    var r = el && el.getBoundingClientRect();
    return !!r && r.height > 0 && r.top >= 0 && r.bottom <= win.innerHeight;
  }

  test("upload is shown even when scrolled down", function () {
    var f = document.createElement("iframe");
    f.style.cssText = "width:390px;height:700px";
    document.body.appendChild(f);
    f.src = "/index.html?mock=slowupload#gallery";
    var w = function () { return f.contentWindow; };
    var q = function (sel) { return f.contentDocument.querySelector("#gallery-body " + sel); };
    return waitFor(function () { return f.contentDocument.querySelectorAll('#gallery-body [data-g="tile"]').length >= 20; }, "tiles").then(function () {
      w().scrollTo(0, 2000);
      return waitFor(function () { return w().scrollY > 1000; }, "scrolled down");
    }).then(function () {
      return jpegFile(w());
    }).then(function (file) {
      return pickAndUpload(f, file);
    }).then(function () {
      return waitFor(function () { return inView(w(), q('[data-g="uploading-tile"]')); }, "new tile on screen");
    }).then(function () {
      return wait(600);   // the panel's Back has landed by now; the view must not jump back down
    }).then(function () {
      ok(inView(w(), q('[data-g="uploading-tile"]')), "new tile went off screen again");
      w().scrollTo(0, 2000);
      return waitFor(function () { return w().scrollY > 1000; }, "scrolled down again");
    }).then(function () {
      ok(inView(w(), q('[data-g="uploading"]')), "uploading line not kept in sight while scrolling");
      f.remove();
    }, function (e) { f.remove(); throw e; });
  }, { timeoutMs: 15000 });

  test("hide does not cancel uploads", function () {
    var f = document.createElement("iframe");
    f.style.cssText = "width:390px;height:700px";
    document.body.appendChild(f);
    f.src = "/index.html?mock=slowupload#gallery";
    var doc = function () { return f.contentDocument; };
    var q = function (sel) { return doc().querySelector("#gallery-body " + sel); };
    var tileIds = function () {
      return [].map.call(doc().querySelectorAll('#gallery-body [data-g="tile"]'), function (t) { return t.dataset.id; });
    };
    var before;
    return waitFor(function () { return q('[data-g="tile"]'); }, "tile").then(function () {
      before = tileIds();
      q('[data-g="add"]').click();
      return jpegFile(f.contentWindow);
    }).then(function (file) {
      var input = q('input[type="file"]');
      ok(input, "file input missing");
      eq([input.accept, input.multiple], ["image/*", true]);
      var dt = new f.contentWindow.DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return waitFor(function () { var p = q('[data-g="panel"]'); return p && !p.hidden && q('[data-g="panel-upload"]'); }, "panel");
    }).then(function (upload) {
      upload.click();
      return waitFor(function () { return q('[data-g="uploading-tile"]'); }, "uploading tile");
    }).then(function () {
      f.contentWindow.location.hash = "program";
      return wait(4000);
    }).then(function () {
      f.contentWindow.location.hash = "gallery";
      return waitFor(function () {
        return tileIds().filter(function (id) { return before.indexOf(id) < 0; }).length === 1;
      }, "new photo in the grid", 1500);
    }).then(function () {
      ok(!q('[data-g="failed-tile"]'), "a failed tile is shown");
      ok(!q('[data-g="uploading-tile"]'), "still uploading");
      f.remove();
    }, function (e) { f.remove(); throw e; });
  }, { timeoutMs: 15000 });
})();
