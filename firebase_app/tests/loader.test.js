// Loads the real site in iframes and checks the gallery loader and containment.
(function () {
  "use strict";

  function open(url) {
    var f = document.createElement("iframe");
    f.style.cssText = "width:390px;height:700px";
    document.body.appendChild(f);
    f.src = url;
    return f;
  }

  function waitFor(fn, what) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function poll() {
        var v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start > 3500) return reject(new Error("timed out waiting for " + what));
        setTimeout(poll, 50);
      })();
    });
  }

  function withFrame(url, fn) {
    var f = open(url);
    return Promise.resolve().then(function () { return fn(f); }).then(
      function () { f.remove(); },
      function (e) { f.remove(); throw e; }
    );
  }

  var doc = function (f) { return f.contentDocument; };
  var T = function () { return self.SITE_CONFIG.text.gallery; };

  test("gallery loads and mounts", function () {
    return withFrame("/index.html#gallery", function (f) {
      return waitFor(function () { return doc(f).querySelector('#gallery-body [data-g="grid"]'); }, "grid").then(function () {
        ok(doc(f).querySelector('script[src*="gallery/gallery.js"]'), "gallery.js script missing");
      });
    });
  });

  test("gallery not loaded on home", function () {
    return withFrame("/index.html", function (f) {
      return waitFor(function () { return doc(f).querySelectorAll("#home-tiles .tile").length; }, "home tiles").then(function () {
        eq(doc(f).querySelectorAll('script[src*="gallery/"], link[href*="gallery/"]').length, 0);
      });
    });
  });

  function calmCard(url, then) {
    return withFrame(url, function (f) {
      return waitFor(function () {
        var el = doc(f).querySelector('#gallery-body [data-g="state"]');
        return el && el.textContent === T().errorTitle;
      }, "calm card").then(function () {
        var button = doc(f).querySelector("#gallery-body button");
        ok(button, "Try again button missing");
        eq(button.textContent, T().tryAgain);
        return then(f);
      });
    });
  }

  test("missing module file shows calm card", function () {
    return calmCard("/index.html?break=load#gallery", function (f) {
      f.contentWindow.location.hash = "";
      return waitFor(function () {
        var d = doc(f);
        return !d.getElementById("view-home").hidden && d.querySelectorAll("#home-tiles .tile").length;
      }, "home tiles");
    });
  });

  test("mount throwing shows calm card", function () {
    return calmCard("/index.html?break=mount#gallery", function (f) {
      f.contentWindow.location.hash = "program";
      return waitFor(function () { return doc(f).querySelectorAll("#program-body .event").length; }, "program events");
    });
  });

  test("coming soon when endpoint empty", function () {
    return withFrame("/index.html?mock=none#gallery", function (f) {
      return waitFor(function () { return doc(f).querySelector("#gallery-body .coming-soon"); }, "coming soon").then(function () {
        eq(doc(f).querySelectorAll('script[src*="gallery/"]').length, 0);
      });
    });
  });

  /* ---------- Try again, parallel loading, the service worker ---------- */

  var FILE_COUNT = 11;   // app.js GALLERY_FILES
  var grid = function (f) { return doc(f).querySelector('#gallery-body [data-g="grid"]'); };
  var key = function () { return String(Date.now()) + Math.random().toString(16).slice(2); };

  // Every gallery file the page asked for, from the page's own resource list.
  function galleryRequests(f) {
    return f.contentWindow.performance.getEntriesByType("resource")
      .map(function (e) { return e.name; })
      .filter(function (n) { return /\/gallery\/[\w-]+\.(js|css)/.test(n); });
  }

  // Backend actions sent from the page from now on.
  function recordActions(f) {
    var sent = [];
    var win = f.contentWindow;
    var real = win.fetch;
    win.fetch = function (url, init) {
      try { sent.push(JSON.parse(init.body).action); } catch (e) { /* not a backend call */ }
      return real.apply(this, arguments);
    };
    return sent;
  }

  function tapTryAgain(f) {
    return waitFor(function () {
      var el = doc(f).querySelector('#gallery-body [data-g="state"]');
      return el && el.textContent === T().errorTitle && doc(f).querySelector("#gallery-body button");
    }, "calm card").then(function (button) { button.click(); });
  }

  test("try again after a load failure recovers", function () {
    // break=once: gallery.js answers "not found" the first time only.
    return withFrame("/index.html?break=once&k=" + key() + "#gallery", function (f) {
      return tapTryAgain(f).then(function () {
        return waitFor(function () { return grid(f); }, "grid after Try again");
      }).then(function () {
        eq(doc(f).querySelectorAll('#gallery-body [data-g="grid"]').length, 1, "one gallery");
        eq(doc(f).querySelectorAll("[data-gallery-file]").length, FILE_COUNT, "failed try's files removed");
        var urls = galleryRequests(f);
        ok(urls.filter(function (u) { return /gallery\.js/.test(u); }).length >= 2, "gallery.js asked for again: " + urls);
        eq(urls.filter(function (u) { return /[?&]r=/.test(u); }), [], "no ?r= stamp");
      });
    });
  }, { timeoutMs: 15000 });

  test("gallery files are requested in parallel", function () {
    return withFrame("/index.html", function (f) {
      var atFirstLoad = -1;
      return waitFor(function () { return doc(f).querySelectorAll("#home-tiles .tile").length; }, "home tiles").then(function () {
        doc(f).addEventListener("load", function (e) {
          if (atFirstLoad < 0 && e.target.dataset && e.target.dataset.galleryFile) {
            atFirstLoad = doc(f).querySelectorAll("[data-gallery-file]").length;
          }
        }, true);
        f.contentWindow.location.hash = "gallery";
        return waitFor(function () { return grid(f); }, "grid");
      }).then(function () {
        eq(atFirstLoad, FILE_COUNT, "files in the page when the first one finished");
      });
    });
  });

  test("try again after show fails does not mount a second copy", function () {
    // break=show: the page's first show() runs, then throws (the copy's timer is already going).
    return withFrame("/index.html?break=show#gallery", function (f) {
      var sent;
      return tapTryAgain(f).then(function () {
        return waitFor(function () { return grid(f) && doc(f).querySelector('#gallery-body [data-g="tile"]'); }, "grid after Try again");
      }).then(function () {
        eq(doc(f).querySelectorAll('#gallery-body [data-g="grid"]').length, 1, "one gallery on screen");
        sent = recordActions(f);
        doc(f).dispatchEvent(new Event("visibilitychange"));   // each live copy looks for new photos
        return new Promise(function (r) { setTimeout(r, 600); });
      }).then(function () {
        eq(sent.filter(function (a) { return a === "list"; }).length, 1, "list requests from live copies");
      });
    });
  }, { timeoutMs: 15000 });

  // Requests other than page loads never get index.html from the service worker: a slow one
  // keeps waiting for the network (here a 1px GIF held back past the worker's 4 s limit).
  test("service worker gives the page only to page loads", function () {
    return withFrame("/index.html", function (f) {
      return waitFor(function () { return f.contentWindow.navigator.serviceWorker.controller; }, "service worker").then(function () {
        return f.contentWindow.fetch("/dev/hold?ms=4600&k=" + key());
      }).then(function (res) {
        eq(res.headers.get("Content-Type"), "image/gif");
      });
    });
  }, { timeoutMs: 15000 });

  function uploadsFlag(url, expected) {
    return withFrame(url, function (f) {
      return waitFor(function () {
        var el = doc(f).querySelector("#gallery-body [data-uploads-open]");
        return el && el.dataset.uploadsOpen === expected;
      }, "data-uploads-open=" + expected);
    });
  }

  test("pause key read", function () {
    return uploadsFlag("/index.html?sheet=paused#gallery", "false").then(function () {
      return uploadsFlag("/index.html#gallery", "true");
    });
  });

  /* ---------- the first photos asked for early, from Home ---------- */

  // Backend requests the page has finished (thumbnails are /mock-api/img/..., not these).
  function backendCalls(f) {
    return f.contentWindow.performance.getEntriesByType("resource").filter(function (e) {
      return /\/mock-api\?/.test(e.name) && e.initiatorType === "fetch";
    });
  }

  function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  test("early list asked from Home, quietly", function () {
    localStorage.removeItem("gallery-device");
    return withFrame("/index.html?early=100&fresh=1", function (f) {
      return waitFor(function () { return backendCalls(f).length; }, "early list").then(function () {
        var d = doc(f);
        eq(galleryRequests(f), [], "gallery files not loaded for it");
        eq(d.getElementById("gallery-body").children.length, 0, "nothing drawn");
        ok(d.getElementById("status").hidden, "no status line");
        ok(!d.getElementById("view-home").hidden, "still on Home");
        ok(/^[0-9a-f]{32}$/.test(localStorage.getItem("gallery-device") || ""), "phone code made for it");
        return pause(400).then(function () { eq(backendCalls(f).length, 1, "asked once only"); });
      });
    });
  });

  test("Gallery opened after the early list uses it", function () {
    return withFrame("/index.html?early=100&fresh=1", function (f) {
      return waitFor(function () { return backendCalls(f).length; }, "early list").then(function () {
        f.contentWindow.location.hash = "gallery";
        return waitFor(function () { return doc(f).querySelectorAll('#gallery-body [data-g="tile"]').length; }, "tiles");
      }).then(function () {
        return pause(300);
      }).then(function () {
        eq(backendCalls(f).length, 1, "no second list request");
      });
    });
  });

  test("early list that fails changes nothing; the Gallery asks again", function () {
    return withFrame("/index.html?early=100&fresh=1&mock=html", function (f) {
      return waitFor(function () { return backendCalls(f).length; }, "early list").then(function () {
        return pause(200);
      }).then(function () {
        var d = doc(f);
        ok(d.getElementById("status").hidden, "no status line");
        eq(d.getElementById("gallery-body").children.length, 0, "nothing drawn");
        f.contentWindow.location.hash = "gallery";
        return waitFor(function () { return backendCalls(f).length >= 2; }, "Gallery's own list");
      });
    });
  });

  test("no early list when it is off, or the Gallery is hidden", function () {
    return withFrame("/index.html?early=0", function (f) {
      return waitFor(function () { return doc(f).querySelectorAll("#home-tiles .tile").length; }, "home").then(function () {
        return pause(600);
      }).then(function () {
        eq(backendCalls(f).length, 0, "early=0");
      });
    }).then(function () {
      return withFrame("/index.html?early=100&sheet=hidden", function (f) {
        return waitFor(function () { return doc(f).querySelectorAll("#home-tiles .tile").length; }, "home").then(function () {
          return pause(600);
        }).then(function () {
          eq(backendCalls(f).length, 0, "Gallery hidden");
        });
      });
    }).then(function () {
      // Put the normal Sheet back in the page's saved copy for the tests after this one.
      return withFrame("/index.html?early=0", function (f) {
        return waitFor(function () {
          return doc(f).querySelector('#home-tiles a[href="#gallery"], #home-tiles [data-route="gallery"]') ||
            [].some.call(doc(f).querySelectorAll("#home-tiles .tile"), function (t) { return /gallery/i.test(t.textContent); });
        }, "Gallery tile back");
      });
    });
  }, { timeoutMs: 15000 });

  test("Gallery's loading shows the three bars", function () {
    return withFrame("/index.html?mock=slow&fresh=1#gallery", function (f) {
      return waitFor(function () { return doc(f).querySelector("#gallery-body .loading-bars"); }, "bars").then(function (bars) {
        eq(bars.querySelectorAll("span").length, 3);
        eq([bars.getAttribute("role"), bars.getAttribute("aria-label")], ["status", T().loading]);
        ok(getComputedStyle(bars.querySelector("span")).animationName === "loading-bar", "bars not moving");
      });
    });
  }, { timeoutMs: 15000 });
})();
