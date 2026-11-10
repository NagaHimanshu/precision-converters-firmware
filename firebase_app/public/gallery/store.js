/* Photo list state: first page, more pages, quiet refresh, the list saved on the
   phone for offline viewing, hearts (shown at once, sent when things settle), and
   deleting the guest's own photos (the Remove / Keep question is asked before, by gallery.js). */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});

  const SAVED_KEY = "gallery-saved";
  const PENDING_KEY = "gallery-pending-hearts";

  // A photo from the backend or from storage, made safe to use; null if unusable.
  function cleanPhoto(p) {
    if (!p || typeof p.id !== "string" || !p.id) return null;
    return {
      id: p.id,
      by: typeof p.by === "string" ? p.by : "",
      at: Number(p.at) || 0,
      hearts: cleanCount(p.hearts),
      hearted: p.hearted === true,
      mine: p.mine === true,
    };
  }

  function cleanList(list) {
    return Array.isArray(list) ? list.map(cleanPhoto).filter(Boolean) : [];
  }

  function cleanCount(n) {
    return Math.max(0, Math.floor(Number(n) || 0));
  }

  function cleanNext(next) {
    return typeof next === "string" && next ? next : null;
  }

  function codeOf(err) {
    return (err && err.code) || "unavailable";
  }

  function create({ api, identity, cfg, storageGet, storageSet }) {
    const s = {
      tab: "all", photos: [], total: 0, next: null, status: "idle", error: null,
      fromSaved: false, uploadsOpen: true, full: false,
      account: identity.account ? identity.account() : null,   // the server's answer replaces it
      deleting: [],               // ids being deleted right now
      deleteError: null,          // { id, code }: the last delete that failed
    };
    const wishes = new Map();     // photo id -> { desired, sending }: hearts not yet confirmed
    const listeners = new Set();
    let run = 0;                  // bumped by load(); answers from older runs are dropped
    let listing = false;          // a list request is running
    let pagedOn = false;          // more than the first page is loaded
    let listSeq = 0;              // numbers each list request when it is sent
    const confirmed = new Map();  // photo id -> { seq, hearts, hearted }: heart answers newer than list request `seq`
    const deletes = new Map();    // photo id -> its delete request (one at a time per photo)
    const gone = new Set();       // ids deleted this visit: a list sent before the delete must not bring them back
    let snap = null;

    /* ---------- state out ---------- */

    // A photo as the guest should see it: unconfirmed heart taps applied.
    function shown(p) {
      const w = wishes.get(p.id);
      if (!w || w.desired === p.hearted) return Object.assign({}, p);
      return Object.assign({}, p, { hearted: w.desired, hearts: Math.max(0, p.hearts + (w.desired ? 1 : -1)) });
    }

    function snapshot() {
      if (!snap) snap = Object.freeze(Object.assign({}, s, { photos: s.photos.map(shown) }));
      return snap;
    }

    function emit() {
      snap = null;
      const state = snapshot();
      for (const fn of listeners) {
        try { fn(state); } catch (e) { console.warn("Gallery view failed:", e); }
      }
    }

    /* ---------- phone storage ---------- */

    function save() {
      if (s.tab !== "all" || s.fromSaved) return;
      storageSet(SAVED_KEY, JSON.stringify({ photos: s.photos.slice(0, cfg.savedListSize), total: s.total }));
    }

    function readSaved() {
      try {
        const v = JSON.parse(storageGet(SAVED_KEY) || "null");
        const photos = cleanList(v && v.photos);
        return photos.length ? { photos, total: Math.max(photos.length, cleanCount(v.total)) } : null;
      } catch (e) {
        return null;
      }
    }

    // A deleted photo out of the saved All photos list too (it is only rewritten on that tab).
    function dropSaved(id) {
      const saved = readSaved();
      if (!saved || !saved.photos.some((p) => p.id === id)) return;
      storageSet(SAVED_KEY, JSON.stringify({
        photos: saved.photos.filter((p) => p.id !== id), total: Math.max(0, saved.total - 1),
      }));
    }

    function readPending() {
      try {
        const v = JSON.parse(storageGet(PENDING_KEY) || "{}");
        const out = {};
        if (v && typeof v === "object") {
          for (const [id, on] of Object.entries(v)) if (typeof on === "boolean") out[id] = on;
        }
        return out;
      } catch (e) {
        return {};
      }
    }

    // on = true/false queues a heart; undefined forgets it.
    function writePending(id, on) {
      const pending = readPending();
      if (on === undefined && !(id in pending)) return;
      if (on === undefined) delete pending[id];
      else pending[id] = on;
      storageSet(PENDING_KEY, JSON.stringify(pending));
    }

    /* ---------- list ---------- */

    // Resolves { res, seq }; seq tells later whether a heart answer is newer than this list.
    function list(extra) {
      const seq = ++listSeq;
      return api.call("list", Object.assign({ device: identity.device(), limit: cfg.pageSize },
        s.tab === "mine" ? { mine: true } : {}, extra)).then((res) => ({ res, seq }));
    }

    // Photos from list request `seq`, keeping heart answers that came back after it was sent
    // (a slow list may still carry the state from before the heart, or a photo deleted since).
    function listPhotos(res, seq) {
      return cleanList(res.photos).filter((p) => !gone.has(p.id)).map((p) => {
        const c = confirmed.get(p.id);
        if (!c) return p;
        if (seq <= c.seq) return Object.assign(p, { hearts: c.hearts, hearted: c.hearted });
        confirmed.delete(p.id);   // this list was asked for after the heart: it already knows
        return p;
      });
    }

    // Deleted photos that a list sent before the delete still counted.
    function goneIn(res) {
      return cleanList(res.photos).filter((p) => gone.has(p.id)).length;
    }

    function applyMeta(res) {
      s.total = Math.max(0, cleanCount(res.total) - goneIn(res));
      s.uploadsOpen = res.uploadsOpen !== false;
      s.full = res.full === true;
      s.account = res.account && typeof res.account.name === "string" ? { name: res.account.name } : null;
      // The server decides who this phone is signed in as; the phone keeps its answer.
      if (identity.setAccount) identity.setAccount(s.account);
    }

    function replace(res, seq) {
      s.photos = listPhotos(res, seq);
      s.next = cleanNext(res.next);
      applyMeta(res);
      s.status = "ready";
      s.error = null;
      s.fromSaved = false;
      pagedOn = false;
      save();
      emit();
    }

    // Fresh first page into what is shown: known photos are updated in place,
    // new ones go on top, nothing already shown moves.
    function merge(res, seq) {
      const fresh = listPhotos(res, seq);
      const byId = new Map(fresh.map((p) => [p.id, p]));
      const have = new Set(s.photos.map((p) => p.id));
      s.photos = fresh.filter((p) => !have.has(p.id)).concat(s.photos.map((p) => byId.get(p.id) || p));
      if (!pagedOn) s.next = cleanNext(res.next);
      applyMeta(res);
      s.error = null;
      save();
      emit();
    }

    async function load(tab) {
      if (tab && tab !== s.tab) {
        s.tab = tab;
        s.photos = [];
        s.total = 0;
        s.next = null;
        s.fromSaved = false;
      }
      s.deleteError = null;
      const mine = ++run;
      listing = true;
      s.status = "loading";
      s.error = null;
      emit();
      try {
        const { res, seq } = await list({});
        if (mine !== run) return;
        replace(res, seq);
      } catch (e) {
        if (mine !== run) return;
        console.warn("Gallery list failed:", e);
        const saved = !s.photos.length && s.tab === "all" ? readSaved() : null;
        if (saved) {
          s.photos = saved.photos;
          s.total = saved.total;
          s.next = null;
          s.fromSaved = true;
        }
        s.status = s.photos.length ? "ready" : "error";
        s.error = codeOf(e);
        emit();
        return;
      } finally {
        if (mine === run) listing = false;
      }
      flush();
    }

    async function loadMore() {
      if (!s.next || listing || s.status !== "ready" || s.fromSaved) return;
      const mine = run;
      listing = true;
      try {
        const { res, seq } = await list({ cursor: s.next });
        if (mine !== run) return;
        const have = new Set(s.photos.map((p) => p.id));
        s.photos = s.photos.concat(listPhotos(res, seq).filter((p) => !have.has(p.id)));
        s.next = cleanNext(res.next);
        applyMeta(res);
        s.error = null;
        pagedOn = true;
        save();
        emit();
      } catch (e) {
        if (mine !== run) return;
        console.warn("Gallery list failed:", e);
        s.error = codeOf(e);
        emit();
      } finally {
        if (mine === run) listing = false;
      }
    }

    // Quiet: a failure changes nothing on screen.
    async function refresh() {
      if (listing) return;
      if (s.status === "idle") return load();
      const mine = run;
      listing = true;
      try {
        const { res, seq } = await list({});
        if (mine !== run) return;
        if (s.status === "ready" && !s.fromSaved) merge(res, seq);
        else replace(res, seq);
      } catch (e) {
        if (mine === run) console.warn("Gallery refresh failed:", e);
        return;
      } finally {
        if (mine === run) listing = false;
      }
      flush();
    }

    /* ---------- hearts ---------- */

    function find(id) {
      return s.photos.find((p) => p.id === id);
    }

    function toggleHeart(id) {
      const p = find(id);
      let w = wishes.get(id);
      if (!w) {
        w = { desired: p ? p.hearted : false, sending: false };
        wishes.set(id, w);
      }
      w.desired = !w.desired;
      emit();
      send(id);
    }

    // One request per photo at a time; after each answer, send again if the
    // guest's last tap differs from what the server now has.
    function send(id) {
      const w = wishes.get(id);
      if (!w || w.sending) return;
      w.sending = true;
      api.call("heart", { device: identity.device(), id, on: w.desired }).then((res) => {
        w.sending = false;
        const hearted = res.hearted === true;
        const hearts = cleanCount(res.hearts);
        confirmed.set(id, { seq: listSeq, hearts, hearted });
        const p = find(id);
        if (p) {
          p.hearts = hearts;
          p.hearted = hearted;
        }
        if (wishes.get(id) !== w) return;
        if (w.desired !== hearted) return send(id);
        wishes.delete(id);
        writePending(id, undefined);
        emit();
      }, (err) => {
        w.sending = false;
        console.warn("Gallery heart failed:", err);
        if (wishes.get(id) !== w) return;   // the photo was deleted meanwhile
        const p = find(id);
        if (p && p.hearted === w.desired) {
          wishes.delete(id);
          writePending(id, undefined);
        } else {
          writePending(id, w.desired);
        }
        emit();
      });
    }

    // Hearts that couldn't be sent earlier (this visit or a past one).
    function flush() {
      const pending = readPending();
      const ids = Object.keys(pending);
      if (!ids.length) return;
      for (const id of ids) {
        if (!wishes.has(id)) wishes.set(id, { desired: pending[id], sending: false });
      }
      emit();
      ids.forEach(send);
    }

    /* ---------- changes from other parts (uploads, delete, sign-in) ---------- */

    function insert(photo) {
      const p = cleanPhoto(photo);
      if (!p || gone.has(p.id)) return;
      const i = s.photos.findIndex((x) => x.id === p.id);
      if (i >= 0) s.photos[i] = p;
      else {
        s.photos.unshift(p);
        s.total += 1;
      }
      save();
      emit();
    }

    // Out of the list shown, the saved list and the hearts still to send. No emit.
    function drop(id) {
      wishes.delete(id);
      confirmed.delete(id);
      writePending(id, undefined);
      dropSaved(id);
      const before = s.photos.length;
      s.photos = s.photos.filter((p) => p.id !== id);
      if (s.photos.length === before) return;
      s.total = Math.max(0, s.total - 1);
      save();
    }

    function remove(id) {
      drop(id);
      emit();
    }

    // Resolves (never rejects) once the server has answered. Success: the photo leaves
    // both tabs; failure: it stays and deleteError says why.
    function deletePhoto(id) {
      if (deletes.has(id)) return deletes.get(id);
      const settle = () => {
        deletes.delete(id);
        s.deleting = Array.from(deletes.keys());
      };
      const done = api.call("delete", { device: identity.device(), id }).then(() => {
        settle();
        gone.add(id);
        drop(id);
        emit();
      }, (err) => {
        console.warn("Gallery delete failed:", err);
        settle();
        s.deleteError = { id, code: codeOf(err) };
        emit();
      });
      deletes.set(id, done);
      s.deleting = Array.from(deletes.keys());
      s.deleteError = null;
      emit();
      return done;
    }

    function setFlags(flags) {
      flags = flags || {};
      if (flags.uploadsOpen !== undefined) s.uploadsOpen = !!flags.uploadsOpen;
      if (flags.full !== undefined) s.full = !!flags.full;
      if (flags.account !== undefined) s.account = flags.account ? { name: String(flags.account.name || "") } : null;
      emit();
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return {
      get state() { return snapshot(); },
      subscribe, load, loadMore, refresh, toggleHeart, insert, remove, deletePhoto, setFlags,
    };
  }

  W.store = { create };
})();
