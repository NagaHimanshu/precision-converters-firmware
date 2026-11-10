/* Gallery backend client: one POST per call, JSON in and out. Every failure
   becomes a GalleryError with a short code; nothing here ever hangs. */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});
  const { GalleryError } = W.errors;

  // Codes the backend may answer with (see the backend contract).
  const CODES = ["busy", "unavailable", "full", "paused", "invalid", "forbidden",
    "too_large", "rate_limited", "signin_failed"];
  // Failures worth another try; "offline" is added by the client itself.
  const RETRYABLE = ["busy", "unavailable", "offline"];

  function create(options) {
    const fetchImpl = options.fetchImpl || ((...a) => self.fetch(...a));

    function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

    // One attempt. Resolves the ok:true body or throws a GalleryError;
    // err.timedOut marks a timeout.
    async function attempt(action, payload, timeoutMs) {
      const controller = new AbortController();
      let timer;
      const limit = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const e = new GalleryError("unavailable", "timeout");
          e.timedOut = true;
          reject(e);
        }, timeoutMs);
      });
      const work = (async () => {
        let res;
        try {
          res = await fetchImpl(options.endpoint, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(Object.assign({ action }, payload)),
            signal: controller.signal,
          });
        } catch (e) {
          if (e instanceof GalleryError) throw e;
          throw new GalleryError(self.navigator.onLine === false ? "offline" : "unavailable", String(e));
        }
        if (!res.ok) throw new GalleryError("unavailable", "HTTP " + res.status);
        let body;
        try { body = JSON.parse(await res.text()); } catch (e) {
          throw new GalleryError("unavailable", "not JSON");
        }
        if (!body || typeof body.ok !== "boolean") throw new GalleryError("unavailable", "bad body");
        if (!body.ok) throw new GalleryError(CODES.includes(body.code) ? body.code : "unavailable", "backend");
        return body;
      })();
      work.catch(() => {});   // a late failure after the timeout is not an error
      try {
        return await Promise.race([work, limit]);
      } finally {
        clearTimeout(timer);
      }
    }

    // opts: { timeoutMs, retries } override the defaults for this call.
    async function call(action, payload, opts) {
      opts = opts || {};
      const isUpload = action === "upload";
      const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs
        : (isUpload ? options.uploadTimeoutMs : options.requestTimeoutMs);
      const retries = opts.retries != null ? opts.retries : options.retries;
      for (let n = 0; ; n++) {
        try {
          return await attempt(action, payload || {}, timeoutMs);
        } catch (e) {
          // An upload that timed out may have arrived; only retry it when asked to.
          const risky = isUpload && e.timedOut && opts.retries == null;
          if (n >= retries || risky || !RETRYABLE.includes(e.code)) throw e;
          await wait(options.retryBackoffMs * Math.pow(2, n));
        }
      }
    }

    return { call };
  }

  W.api = { create, CODES };
})();
