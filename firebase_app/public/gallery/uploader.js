/* Upload queue: shrinks picked photos one at a time and sends a few at once.
   A photo that fails is marked on its own and can be tried again; "full" or
   "paused" stops the rest. It keeps going when the guest leaves the Gallery. */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});
  const { GalleryError } = W.errors;

  const ACTIVE = ["waiting", "preparing", "uploading"];
  // How full the ring is drawn: while shrinking, when sending starts, and the most
  // it shows before the answer arrives (sending progress itself can't be measured).
  const RING_PREPARING = 0.1;
  const RING_SENDING = 0.2;
  const RING_MOST = 0.95;

  function cleanName(s, max) {
    return Array.from(String(s == null ? "" : s).trim()).slice(0, max).join("").trim();
  }

  function create({ api, identity, image, cfg, store, onChange }) {
    const list = [];               // items in the order they were added
    let seq = 0;
    let round = 0;                 // one round = from the first photo added until all are finished
    let dropped = 0;               // photos left out in this round (over the limit, not photos)
    let workers = 0;
    let prepTurn = Promise.resolve();
    let ticker = null;
    // Photo id -> small copy of a photo shared this visit: its grid tile shows it until
    // the real picture has loaded (that can take a while for a photo just added).
    const kept = new Map();

    function busy() {
      return list.some((i) => ACTIVE.includes(i.status));
    }

    // Redraw the rings now and then while something is being sent.
    function keepTicking() {
      const sending = list.some((i) => i.status === "uploading");
      if (sending && !ticker) ticker = setInterval(notify, cfg.progressTickMs);
      if (!sending && ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    }

    function notify() {
      try { if (onChange) onChange(); } catch (e) { console.warn("Gallery view failed:", e); }
    }

    function changed() {
      keepTicking();
      notify();
    }

    function freePreview(item) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      item.previewUrl = null;
    }

    // Starting again after everything finished: forget the finished photos.
    function newRoundIfIdle() {
      if (busy()) return;
      round++;
      dropped = 0;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].status === "done") list.splice(i, 1);
    }

    function finish(item) {
      item.status = "done";
      item.code = null;
      item.file = null;
      freePreview(item);
      changed();
    }

    function fail(item, code) {
      item.status = "failed";
      item.code = code;
      item.blob = null;
      changed();
    }

    // The album is full or uploads are paused: nothing else waiting will get in.
    function stop(code) {
      for (const i of list) if (i.status === "waiting" || i.status === "preparing") fail(i, code);
      store.setFlags(code === "full" ? { full: true } : { uploadsOpen: false });
    }

    // The next waiting photo, shrunk; only one is ever being shrunk. Resolves null when none wait.
    function nextPrepared() {
      const turn = prepTurn.then(async () => {
        const item = list.find((i) => i.status === "waiting");
        if (!item) return null;
        item.status = "preparing";
        changed();
        try {
          const r = await image.toJpeg(item.file, {
            maxLongEdgePx: cfg.maxLongEdgePx, jpegQuality: cfg.jpegQuality, previewPx: cfg.previewSizePx,
          });
          if (item.status !== "preparing") return item;          // stopped meanwhile
          if (r.preview && !item.previewUrl) item.previewUrl = URL.createObjectURL(r.preview);
          item.blob = r.blob;
        } catch (e) {
          console.warn("Gallery photo can't be read:", e);
          if (item.status === "preparing") fail(item, "unsupported");
        }
        return item;
      });
      prepTurn = turn.catch(() => {});
      return turn;
    }

    async function send(item) {
      const blob = item.blob;
      item.blob = null;
      if (blob.size > cfg.maxUploadBytes) return fail(item, "too_large");
      item.status = "uploading";
      item.startedAt = Date.now();
      changed();
      try {
        const data = await image.toBase64(blob);
        const res = await api.call("upload",
          { device: identity.device(), name: item.name, mime: "image/jpeg", data },
          { timeoutMs: cfg.uploadTimeoutMs });
        if (!res || !res.photo || typeof res.photo.id !== "string") throw new GalleryError("unavailable", "no photo");
        if (item.previewUrl) kept.set(res.photo.id, item.previewUrl);
        store.insert(res.photo);          // the server's copy: its name and time are the real ones
        item.previewUrl = null;           // kept for the photo's tile, not freed
        finish(item);
      } catch (e) {
        const code = (e && e.code) || "unavailable";
        console.warn("Gallery upload failed:", e);
        fail(item, code);
        if (code === "full" || code === "paused") stop(code);
      }
    }

    async function worker() {
      try {
        for (;;) {
          const item = await nextPrepared();
          if (!item) break;
          if (item.blob) await send(item);
        }
      } catch (e) {
        console.warn("Gallery upload queue failed:", e);
      } finally {
        workers--;
        if (list.some((i) => i.status === "waiting")) pump();
      }
    }

    function pump() {
      const waiting = list.filter((i) => i.status === "waiting").length;
      while (workers < Math.min(cfg.parallelUploads, waiting)) {
        workers++;
        worker();
      }
    }

    function add(files, name) {
      const all = Array.from(files || []);
      const take = all.filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/"))
        .slice(0, cfg.maxPhotosPerUpload);
      const clean = cleanName(name, cfg.nameMaxLength);
      const account = identity.account();
      if (!(account && account.name)) identity.setName(clean);   // a Google name is used instead
      newRoundIfIdle();
      dropped += all.length - take.length;
      for (const file of take) {
        list.push({ key: "up" + ++seq, file, name: clean, status: "waiting", code: null,
          previewUrl: null, blob: null, round, startedAt: 0 });
      }
      changed();
      pump();
      return { accepted: take.length, dropped: all.length - take.length };
    }

    function find(key) {
      return list.find((i) => i.key === key);
    }

    function retry(key) {
      const item = find(key);
      if (!item || item.status !== "failed") return;
      newRoundIfIdle();
      item.status = "waiting";
      item.code = null;
      item.round = round;
      changed();
      pump();
    }

    // Takes a failed photo off the screen (e.g. one the phone can't read).
    function dismiss(key) {
      const item = find(key);
      if (!item || item.status !== "failed") return;
      freePreview(item);
      list.splice(list.indexOf(item), 1);
      changed();
    }

    // The small copy for a photo shared this visit (or null), and "its real picture is
    // showing now" (then it is freed).
    function preview(id) {
      return kept.get(id) || null;
    }

    function previewDone(id) {
      const url = kept.get(id);
      if (!url) return;
      kept.delete(id);
      URL.revokeObjectURL(url);
    }

    function ring(i) {
      if (i.status === "done") return 1;
      if (i.status === "preparing") return RING_PREPARING;
      if (i.status !== "uploading") return 0;
      const t = (Date.now() - i.startedAt) / cfg.progressEstimateMs;
      return RING_SENDING + (RING_MOST - RING_SENDING) * (1 - Math.exp(-t));
    }

    function items() {
      return list.map((i) => ({ key: i.key, previewUrl: i.previewUrl, status: i.status, code: i.code, progress: ring(i) }));
    }

    // This round: photos finished (sent or failed), photos in it, photos left out.
    function counts() {
      const mine = list.filter((i) => i.round === round);
      return { finished: mine.filter((i) => !ACTIVE.includes(i.status)).length, total: mine.length, dropped };
    }

    return { add, items, retry, dismiss, busy, counts, preview, previewDone };
  }

  W.uploader = { create };
})();
