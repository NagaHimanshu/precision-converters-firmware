// Tests for gallery/api.js (backend client). Fakes stand in for fetch, except the
// last two tests, which talk to the dev server's stand-in backend.
(function () {
  "use strict";

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200 });
  }
  function make(fetchImpl, over) {
    return WeddingGallery.api.create(Object.assign({
      endpoint: "/x", requestTimeoutMs: 1000, uploadTimeoutMs: 1000,
      retries: 2, retryBackoffMs: 1, fetchImpl: fetchImpl,
    }, over || {}));
  }
  async function code(promise) {
    try { await promise; } catch (e) {
      ok(e instanceof WeddingGallery.errors.GalleryError, "rejects with GalleryError");
      return e.code;
    }
    throw new Error("expected a rejection");
  }

  test("posts text/plain json", async function () {
    let seen;
    const api = make(async function (url, init) { seen = { url: url, init: init }; return jsonResponse({ ok: true }); });
    await api.call("list", { device: "d1", limit: 30 });
    eq(seen.init.method, "POST");
    ok(/^text\/plain/.test(seen.init.headers["Content-Type"]), "content type");
    eq(JSON.parse(seen.init.body), { action: "list", device: "d1", limit: 30 });
  });

  test("ok response resolves body", async function () {
    const api = make(async function () { return jsonResponse({ ok: true, photos: [] }); });
    eq(await api.call("list", {}), { ok: true, photos: [] });
  });

  test("known failure code passes through", async function () {
    let n = 0;
    const api = make(async function () { n++; return jsonResponse({ ok: false, code: "paused" }); });
    eq(await code(api.call("upload", {})), "paused");
    eq(n, 1);
  });

  test("unknown code maps to unavailable", async function () {
    const api = make(async function () { return jsonResponse({ ok: false, code: "weird" }); }, { retries: 0 });
    eq(await code(api.call("list", {})), "unavailable");
  });

  test("html response maps to unavailable", async function () {
    const api = make(async function () { return new Response("<!DOCTYPE html><html></html>", { status: 200 }); }, { retries: 0 });
    eq(await code(api.call("list", {})), "unavailable");
  });

  test("json without ok maps to unavailable", async function () {
    const api = make(async function () { return jsonResponse({ photos: [] }); }, { retries: 0 });
    eq(await code(api.call("list", {})), "unavailable");
  });

  test("http 500 maps to unavailable", async function () {
    let n = 0;
    const api = make(async function () { n++; return new Response("oops", { status: 500 }); });
    eq(await code(api.call("list", {})), "unavailable");
    eq(n, 3);
  });

  test("busy is retried then succeeds", async function () {
    let n = 0;
    const api = make(async function () {
      n++;
      return n < 3 ? jsonResponse({ ok: false, code: "busy" }) : jsonResponse({ ok: true });
    });
    eq(await api.call("list", {}), { ok: true });
    eq(n, 3);
  });

  test("non-retryable codes are not retried", async function () {
    let n = 0;
    const api = make(async function () { n++; return jsonResponse({ ok: false, code: "full" }); });
    eq(await code(api.call("upload", {})), "full");
    eq(n, 1);
  });

  test("timeout maps to unavailable", async function () {
    const t0 = Date.now();
    const api = make(function () { return new Promise(function () {}); }, { requestTimeoutMs: 50, retries: 0 });
    eq(await code(api.call("list", {})), "unavailable");
    ok(Date.now() - t0 < 500, "timed out promptly");
  });

  test("upload is not retried after a timeout", async function () {
    let n = 0;
    const api = make(function () { n++; return new Promise(function () {}); }, { uploadTimeoutMs: 30 });
    eq(await code(api.call("upload", {})), "unavailable");
    eq(n, 1);
  });

  test("opts.retries lets an upload retry after a timeout", async function () {
    let n = 0;
    const api = make(function () { n++; return new Promise(function () {}); }, { uploadTimeoutMs: 20 });
    eq(await code(api.call("upload", {}, { retries: 1 })), "unavailable");
    eq(n, 2);
  });

  test("offline when navigator offline", async function () {
    Object.defineProperty(navigator, "onLine", { get: function () { return false; }, configurable: true });
    try {
      const api = make(async function () { throw new TypeError("Failed to fetch"); }, { retries: 0 });
      eq(await code(api.call("list", {})), "offline");
    } finally {
      delete navigator.onLine;
    }
  });

  test("network error while online maps to unavailable", async function () {
    const api = make(async function () { throw new TypeError("Failed to fetch"); }, { retries: 0 });
    eq(await code(api.call("list", {})), "unavailable");
  });

  test("stand-in contract", async function () {
    const api = WeddingGallery.api.create({
      endpoint: "/mock-api?mode=ok", requestTimeoutMs: 3000, uploadTimeoutMs: 3000,
      retries: 0, retryBackoffMs: 1,
    });
    const device = "c0de".repeat(8);   // 32 hex characters, like a real device code
    const r = await api.call("list", { device: device, limit: 30 });
    eq(r.ok, true);
    eq(r.photos.length, 30);
    ok(r.next !== null, "next present");
    eq(Object.keys(r.photos[0]).sort(), ["at", "by", "hearted", "hearts", "id", "mine"]);
    const r2 = await api.call("list", { device: device, limit: 30, cursor: r.next });
    eq(r2.photos.length, 15);
    eq(r2.next, null);
    // Same rules as apps-script/Code.gs: limit capped, bad cursor = from the start,
    // malformed device code refused.
    const r3 = await api.call("list", { device: device, limit: 500, cursor: "zz" });
    eq([r3.photos.length, r3.photos[0].id], [45, r.photos[0].id]);
    eq(await code(api.call("list", { device: "contract-dev", limit: 30 })), "invalid");
  });

  test("stand-in delete: own photo only, safe to repeat", async function () {
    // Its own mode, so the photo added here never joins another test's album.
    const api = WeddingGallery.api.create({
      endpoint: "/mock-api?mode=deletes", requestTimeoutMs: 3000, uploadTimeoutMs: 3000,
      retries: 0, retryBackoffMs: 1,
    });
    const me = "d1".repeat(16);
    const other = "e2".repeat(16);
    const seeded = (await api.call("list", { device: me, limit: 1 })).photos[0].id;
    eq(await code(api.call("delete", { device: me, id: seeded })), "forbidden", "forbidden for other device");
    const up = await api.call("upload", { device: me, name: "", mime: "image/jpeg", data: btoa("\xff\xd8\xff\xe0 test") });
    const id = up.photo.id;
    eq(await code(api.call("delete", { device: other, id: id })), "forbidden", "someone else's upload");
    eq(await api.call("delete", { device: me, id: id }), { ok: true });
    eq(await api.call("delete", { device: me, id: id }), { ok: true }, "again: already gone is fine");
    eq(await api.call("delete", { device: me, id: "no-such-photo" }), { ok: true });
    eq(await code(api.call("delete", { device: me })), "invalid", "id missing");
    const mine = await api.call("list", { device: me, limit: 30, mine: true });
    eq([mine.photos.length, mine.total], [0, 0]);
    const all = await api.call("list", { device: other, limit: 60 });
    ok(all.photos.every((p) => p.id !== id), "gone for everyone");
    eq(await code(api.call("heart", { device: other, id: id, on: true })), "invalid", "no hearts on a deleted photo");
  });
})();
