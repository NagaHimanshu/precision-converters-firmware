// Tests for gallery/image.js (resize a picked photo to a JPEG on the phone).
(function () {
  "use strict";

  var G = function () { return self.WeddingGallery; };

  // A picture of the given size, as a JPEG blob (like a photo from the picker).
  function picture(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var g = c.getContext("2d");
    var grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#f3c7a6");
    grad.addColorStop(1, "#5f7f99");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return new Promise(function (resolve) {
      c.toBlob(function (b) { c.width = 0; c.height = 0; resolve(b); }, "image/jpeg", 0.8);
    });
  }

  function opts() {
    return { maxLongEdgePx: 2500, jpegQuality: 0.85 };
  }

  function size(blob) {
    return createImageBitmap(blob).then(function (b) {
      var out = [b.width, b.height];
      b.close();
      return out;
    });
  }

  test("downscales long edge", async function () {
    var r = await G().image.toJpeg(await picture(4000, 3000), opts());
    eq([r.width, r.height], [2500, 1875]);
    eq(r.blob.type, "image/jpeg");
    eq(await size(r.blob), [2500, 1875]);
  });

  test("portrait long edge", async function () {
    var r = await G().image.toJpeg(await picture(3000, 4000), opts());
    eq([r.width, r.height], [1875, 2500]);
  });

  test("does not upscale", async function () {
    var r = await G().image.toJpeg(await picture(800, 600), opts());
    eq([r.width, r.height], [800, 600]);
    eq(await size(r.blob), [800, 600]);
  });

  test("rejects non-image", async function () {
    var code = null;
    try {
      await G().image.toJpeg(new Blob(["hello"], { type: "text/plain" }), opts());
    } catch (e) {
      code = e.code;
    }
    eq(code, "unsupported");
  });

  test("base64 has no prefix", async function () {
    var r = await G().image.toJpeg(await picture(40, 30), opts());
    var b64 = await G().image.toBase64(r.blob);
    ok(b64.length > 0, "empty");
    ok(b64.indexOf("data:") !== 0, "has data: prefix");
    eq(atob(b64).charCodeAt(0), 0xff);   // JPEG starts FF D8
  });

  test("preview copy is small", async function () {
    var r = await G().image.toJpeg(await picture(1200, 900), Object.assign(opts(), { previewPx: 200 }));
    eq(await size(r.preview), [200, 150]);
  });

  // Wraps createImageBitmap for one test: spy(file, options) may throw; calls are recorded.
  async function withBitmapSpy(spy, fn) {
    var real = self.createImageBitmap;
    var calls = [];
    self.createImageBitmap = function (src, o) {
      calls.push(o || null);
      if (spy) spy(src, o);
      return real.apply(self, arguments);
    };
    try {
      return { result: await fn(), calls: calls };
    } finally {
      self.createImageBitmap = real;
    }
  }

  test("decodes straight to the target size", async function () {
    var land = await picture(4000, 3000);
    var tall = await picture(3000, 4000);
    var a = await withBitmapSpy(null, function () { return G().image.toJpeg(land, opts()); });
    var b = await withBitmapSpy(null, function () { return G().image.toJpeg(tall, opts()); });
    eq([a.result.width, a.result.height, b.result.width, b.result.height], [2500, 1875, 1875, 2500]);
    var sized = function (c) { return c && c.resizeWidth ? [c.resizeWidth, c.resizeHeight, c.imageOrientation] : null; };
    eq(a.calls.map(sized), [[2500, 1875, "from-image"]]);
    eq(b.calls.map(sized), [[1875, 2500, "from-image"]]);
  });

  test("falls back when a sized decode is refused", async function () {
    var pic = await picture(3000, 2000);
    var r = await withBitmapSpy(function (src, o) {
      if (o && o.resizeWidth) throw new TypeError("resize not supported");
    }, function () { return G().image.toJpeg(pic, opts()); });
    eq([r.result.width, r.result.height], [2500, 1667]);
    eq(r.calls.length, 2);   // the sized try, then the full decode
    eq(await size(r.result.blob), [2500, 1667]);
  });

  // A JPEG stored 400x300 whose EXIF says "rotate 90°" (orientation 6): upright it is 300x400.
  async function sideways() {
    var buf = new Uint8Array(await (await picture(400, 300)).arrayBuffer());
    var app1 = [0xFF, 0xE1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,   // APP1 "Exif\0\0"
      0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,                           // TIFF header, big-endian
      0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,  // Orientation = 6
      0x00, 0x00, 0x00, 0x00];
    var out = new Uint8Array(buf.length + app1.length);
    out.set(buf.subarray(0, 2), 0);
    out.set(app1, 2);
    out.set(buf.subarray(2), 2 + app1.length);
    return new Blob([out], { type: "image/jpeg" });
  }

  test("orientation from the photo, shrunk or not", async function () {
    var pic = await sideways();
    var small = await G().image.toJpeg(pic, { maxLongEdgePx: 200, jpegQuality: 0.85 });
    var full = await G().image.toJpeg(pic, opts());
    eq([small.width, small.height, full.width, full.height], [150, 200, 300, 400]);
    eq(await size(small.blob), [150, 200]);
  });

  // Counts decoded pictures alive at once: from the decode call until bitmap.close().
  test("one decode at a time across callers", async function () {
    var real = self.createImageBitmap;
    var now = 0, max = 0;
    self.createImageBitmap = function () {
      now++;
      max = Math.max(max, now);
      return real.apply(self, arguments).then(function (b) {
        var close = b.close.bind(b);
        b.close = function () { now--; close(); };
        return b;
      }, function (e) { now--; throw e; });
    };
    try {
      var pics = await Promise.all([picture(300, 200), picture(200, 300), picture(100, 100)]);
      await Promise.all(pics.map(function (p) { return G().image.toJpeg(p, opts()); }));
    } finally {
      self.createImageBitmap = real;
    }
    eq([max, now], [1, 0], "[most alive, left open]");
  });
})();
