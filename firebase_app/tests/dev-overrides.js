// Appended to site-config.js by tools/dev_server.py (dev only; never deployed).
// Page query switches: mock=<mode> (default "ok"), fresh=1, sheet=paused|hidden, break=load,
// gis=broken (read by tests/fake-gis.js), noclient=1, early=<ms>. The dev server itself also reads
// break=load|mount|once|show (see tools/dev_server.py).
(function () {
  "use strict";
  var q = new URLSearchParams(location.search);
  var mock = q.get("mock") || "ok";
  var C = self.SITE_CONFIG;
  // fresh=1: act like a first visit to the Gallery (no photo list saved on this phone).
  if (q.get("fresh") === "1") {
    var getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      return key === "gallery-saved" ? null : getItem.call(this, key);
    };
  }
  // sheet=paused: a copy of the sheet with gallery_uploads = no; sheet=hidden: show_gallery = no.
  var sheet = q.get("sheet");
  C.sheet.urlTemplate = sheet === "paused" || sheet === "hidden" ? "/sheet/" + sheet + "/{tab}.csv" : "/sheet/{tab}.csv";
  if (C.gallery) {
    // mock=none: no backend configured (Gallery shows "coming soon").
    C.gallery.endpoint = mock === "none" ? "" : "/mock-api?mode=" + encodeURIComponent(mock);
    // early=<ms>: ask for the first photos this long after opening (0 = never).
    if (q.get("early") !== null) C.gallery.earlyListDelayMs = Number(q.get("early"));
    // break=load: give up quickly when the gallery files can't be loaded.
    if (q.get("break") === "load") C.gallery.scriptLoadTimeoutMs = 1500;
    C.gallery.thumbUrl = "/mock-api/img/{id}?w={size}";
    C.gallery.fullUrl = "/mock-api/img/{id}?w={size}";
    // Google sign-in: the stand-in GIS script (gis=broken makes it define nothing);
    // noclient=1: no client ID, so no sign-in anywhere.
    C.gallery.googleScriptUrl = "/tests/fake-gis.js";
    C.gallery.googleClientId = q.get("noclient") === "1" ? "" : "dev";
  }
})();
