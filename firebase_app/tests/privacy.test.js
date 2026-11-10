// Tests for privacy.html: every word comes from text.privacy in site-config.js, and the
// page needs no Sheet (it never asks for one).
(function () {
  "use strict";

  var P = function () { return self.SITE_CONFIG.text.privacy; };

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
    var f = document.createElement("iframe");
    f.style.cssText = "width:390px;height:700px";
    document.body.appendChild(f);
    f.src = url;
    return Promise.resolve().then(function () { return fn(f); }).then(
      function () { f.remove(); },
      function (e) { f.remove(); throw e; }
    );
  }

  test("privacy page shows every section from config, without the Sheet", function () {
    return withFrame("/privacy.html", function (f) {
      var d = function () { return f.contentDocument; };
      return waitFor(function () { return d().querySelectorAll('[data-g="privacy-section"]').length; }, "sections").then(function () {
        var doc = d();
        var P0 = P();
        var sections = [].map.call(doc.querySelectorAll('[data-g="privacy-section"]'), function (s) {
          return { heading: s.querySelector("h3").textContent,
            paragraphs: [].map.call(s.querySelectorAll("p"), function (p) { return p.textContent; }),
            contact: !!s.querySelector('a[data-g="privacy-contacts"]') };
        });
        var want = P0.sections.map(function (s) {
          return { heading: s.heading, paragraphs: s.paragraphs, contact: !!s.contact };
        });
        eq(sections, want);
        ok(want.length >= 6, "six sections in config");
        ok(want.some(function (s) { return s.contact; }), "a section links to Contacts");
        var title = doc.querySelector(".inner-header h2").textContent;
        eq([title, doc.title], [P0.title, P0.title]);
        eq(doc.querySelector('[data-g="privacy-intro"]').textContent, P0.intro);
        var contacts = [].map.call(doc.querySelectorAll('a[data-g="privacy-contacts"]'), function (a) {
          return [a.textContent, a.href];
        });
        var home = new URL("/", location.href).href;
        ok(contacts.every(function (c) {
          return c[0] === P0.contactLink && c[1] === new URL(self.SITE_CONFIG.gallery.privacyContactsUrl, home).href;
        }), "contacts links: " + JSON.stringify(contacts));
        var back = doc.querySelector(".inner-header .back-btn");
        eq([back.tagName, back.getAttribute("aria-label"), back.href], ["A", self.SITE_CONFIG.text.back, home]);
        ok(doc.querySelector(".inner-header .sprig"), "sprig missing");
        var gold = doc.documentElement.style.getPropertyValue("--gold");
        eq(gold, self.SITE_CONFIG.theme.colors.gold, "theme colours applied");
        var asked = f.contentWindow.performance.getEntriesByType("resource").map(function (e) { return e.name; });
        eq(asked.filter(function (n) { return /\/sheet\/|docs\.google\.com|\/mock-api/.test(n); }), [], "no Sheet or gallery requests");
        ok(!doc.querySelector('script[src*="app.js"]'), "app.js not loaded");
      });
    });
  });
})();
