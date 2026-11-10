/* Full-screen photo viewer: dark overlay, uncropped photo, arrows and swipe,
   "By {name}" + time, big heart, Delete on your own photo, Save (to the phone's
   Downloads, with a short note at the bottom). The phone's Back
   closes it (it adds one history entry while open). It closes by itself when the
   photo it shows leaves the list (deleted). */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});

  // Heart symbols; U+FE0E asks for the plain (colourable) form, not an emoji.
  const HEART_ON = String.fromCharCode(0x2665, 0xFE0E);
  const HEART_OFF = String.fromCharCode(0x2661);

  // If Back somehow never arrives after × (it always should), close anyway after this long.
  const BACK_FALLBACK_MS = 800;

  // A saved photo's temporary address is let go this long after the download starts.
  const SAVE_URL_LIFE_MS = 60000;

  // File name ending for each kind of picture Save may get (anything else: jpg).
  const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

  // onDelete(id): Delete was tapped on the photo shown (the caller asks Remove / Keep first).
  function create({ ctx, store, onDelete }) {
    const { text, h, fill, icon } = ctx;
    const G = ctx.cfg.gallery;
    let openId = null;          // id of the photo shown; followed when the list changes
    let index = 0;
    let generation = 0;         // bumps on each open, so a late fallback can't close a newer one
    let closing = -1;           // = generation while the Back asked for by close() is on its way
    let lastFocus = null;
    let preloads = [];
    const pointers = new Set();
    let swipeFrom = null;
    const saving = new Set();   // ids of photos being fetched for Save
    let toastTimer = 0;

    const counter = h("span", { class: "g-v-counter" });
    const saveLabel = h("span", { class: "g-v-save-label" }, text.save);
    const saveBars = h("span", { class: "loading-bars g-v-save-bars", "aria-hidden": "true" },
      h("span"), h("span"), h("span"));
    const saveButton = h("button", { type: "button", class: "g-v-save", "data-g": "viewer-save",
      onclick: () => openId && save(openId) }, saveLabel);
    const closeButton = h("button", { type: "button", class: "g-v-round g-v-close", "data-g": "viewer-close",
      "aria-label": text.close, onclick: () => close() }, "×");
    const img = h("img", { class: "g-v-img", alt: "", decoding: "async",
      onerror: () => stage.classList.add("is-broken"), onload: () => stage.classList.remove("is-broken") });
    const stage = h("div", { class: "g-v-stage" }, img, icon("gallery"));
    const prevButton = h("button", { type: "button", class: "g-v-round g-v-prev", "data-g": "viewer-prev",
      "aria-label": text.prev, onclick: () => step(-1) }, "‹");
    const nextButton = h("button", { type: "button", class: "g-v-round g-v-next", "data-g": "viewer-next",
      "aria-label": text.next, onclick: () => step(1) }, "›");
    const byName = h("span", { class: "g-v-name" });
    const when = h("span", { class: "g-v-time" });
    const heartGlyph = h("span", { class: "g-glyph", "aria-hidden": "true" });
    const heartCount = h("span", { class: "g-count" });
    const heartButton = h("button", { type: "button", class: "g-v-heart", "data-g": "viewer-heart",
      "aria-label": text.heartLabel, onclick: () => openId && store.toggleHeart(openId) }, heartGlyph, heartCount);
    const deleteButton = h("button", { type: "button", class: "g-v-delete", "data-g": "viewer-delete",
      onclick: () => openId && !deleteButton.disabled && onDelete(openId) }, text.delete);
    const actions = h("div", { class: "g-v-actions" });
    const status = h("p", { class: "g-v-status", "data-g": "viewer-status", role: "status", hidden: "" });   // why a delete didn't work
    const toast = h("p", { class: "g-v-toast", "data-g": "viewer-toast", role: "status", hidden: "" });     // "Saved to Downloads"
    const el = h("div", { class: "g-viewer", "data-g": "viewer", role: "dialog", "aria-modal": "true", hidden: "" },
      h("div", { class: "g-v-top" }, counter, h("div", { class: "g-v-top-actions" }, saveButton, closeButton)),
      stage, prevButton, nextButton, status, toast,
      h("div", { class: "g-v-bar" }, h("div", { class: "g-v-by", "data-g": "viewer-by" }, byName, when), actions));

    /* ---------- time line ---------- */

    function formatter(opts) {
      try { return new Intl.DateTimeFormat(ctx.locale, opts); } catch (e) { return new Intl.DateTimeFormat(undefined, opts); }
    }
    const timeFormat = formatter({ hour: "numeric", minute: "2-digit" });
    const dayFormat = formatter({ day: "numeric", month: "long" });

    function sameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function timeText(at) {
      const d = new Date(at);
      if (!at || isNaN(d.getTime())) return "";
      const time = timeFormat.format(d);
      const now = new Date();
      if (sameDay(d, now)) return fill(text.today, { time });
      if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return fill(text.yesterday, { time });
      return fill(text.dayTime, { date: dayFormat.format(d), time });
    }

    /* ---------- showing a photo ---------- */

    function fullUrl(p) {
      return fill(G.fullUrl, { id: encodeURIComponent(p.id), size: G.fullSizePx });
    }

    function preload(photos, i) {
      const next = [];
      for (let k = 1; k <= G.preloadNeighbours; k++) {
        for (const j of [i + k, i - k]) {
          if (!photos[j]) continue;
          const im = new Image();
          im.decoding = "async";
          im.src = fullUrl(photos[j]);
          next.push(im);
        }
      }
      preloads = next;   // keeps them alive until the next photo
    }

    function render() {
      if (!isOpen()) return;
      const s = store.state;
      const i = s.photos.findIndex((p) => p.id === openId);
      if (i < 0) return close();   // deleted: back to the grid rather than onto someone else's photo
      index = i;
      const p = s.photos[i];
      const last = i >= s.photos.length - 1;
      counter.textContent = fill(text.counter, { n: i + 1, total: Math.max(s.total, s.photos.length) });
      const src = fullUrl(p);
      if (img.getAttribute("src") !== src) {
        stage.classList.remove("is-broken");
        img.setAttribute("src", src);
      }
      byName.textContent = p.by ? fill(text.by, { name: p.by }) : "";
      img.alt = byName.textContent;
      when.textContent = timeText(p.at);
      heartGlyph.textContent = p.hearted ? HEART_ON : HEART_OFF;
      heartCount.textContent = String(p.hearts);
      heartButton.setAttribute("aria-pressed", String(p.hearted));
      heartButton.classList.toggle("is-on", p.hearted);
      actions.replaceChildren(heartButton, p.mine ? deleteButton : "");
      deleteButton.disabled = (s.deleting || []).includes(p.id);
      const failed = s.deleteError && s.deleteError.id === p.id ? s.deleteError : null;
      status.textContent = failed ? W.errors.message(failed.code) : "";
      status.hidden = !failed;
      prevButton.hidden = i === 0;
      nextButton.hidden = last && !s.next;
      if (last && s.next && !s.error) store.loadMore();
      preload(s.photos, i);
      renderSave();
    }

    /* ---------- Save ---------- */

    // Three bars in place of the words while the photo shown is being fetched.
    function renderSave() {
      const busy = !!openId && saving.has(openId);
      saveButton.disabled = busy;
      saveButton.classList.toggle("is-busy", busy);
      saveButton.setAttribute("aria-busy", String(busy));
      if (busy) saveButton.replaceChildren(saveLabel, saveBars);
      else saveButton.replaceChildren(saveLabel);
    }

    function showToast(message) {
      clearTimeout(toastTimer);
      toast.textContent = message;
      toast.hidden = false;
      toastTimer = setTimeout(() => { toast.hidden = true; }, G.toastMs);
    }

    // The photo as a file. A download link can't save a picture from another site by itself,
    // so it is read here first (downloadUrl must allow that). Only a real picture counts.
    async function fetchPhoto(id) {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), G.downloadTimeoutMs);
      try {
        const res = await fetch(fill(G.downloadUrl, { id: encodeURIComponent(id), size: G.downloadSizePx }),
          { mode: "cors", credentials: "omit", signal: stop.signal });
        if (!res.ok) throw new Error("status " + res.status);
        const blob = await res.blob();
        if (!blob.size || !/^image\//i.test(blob.type)) throw new Error("not a photo");
        return blob;
      } finally {
        clearTimeout(timer);
      }
    }

    function download(blob, id) {
      const type = blob.type.split(";")[0].trim().toLowerCase();
      const name = fill(G.downloadName, { id: String(id).replace(/[^\w-]/g, ""), ext: EXTENSIONS[type] || "jpg" });
      const url = URL.createObjectURL(blob);
      const link = h("a", { href: url, download: name, hidden: "" });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), SAVE_URL_LIFE_MS);
    }

    async function save(id) {
      if (saving.has(id)) return;
      saving.add(id);
      renderSave();
      let saved = false;
      try {
        download(await fetchPhoto(id), id);
        saved = true;
      } catch (e) { /* said below */ }
      saving.delete(id);
      renderSave();
      if (isOpen()) showToast(saved ? text.saved : text.saveFailed);
    }

    function step(d) {
      const photos = store.state.photos;
      const i = index + d;
      if (i < 0 || i >= photos.length) return;
      openId = photos[i].id;
      index = i;
      render();
    }

    /* ---------- open / close ---------- */

    function isOpen() {
      return !el.hidden;
    }

    function open(i) {
      const p = store.state.photos[i];
      if (!p) return;
      openId = p.id;
      index = i;
      if (!isOpen()) {
        generation++;
        lastFocus = document.activeElement;
        try { history.pushState({ galleryViewer: true }, ""); } catch (e) { /* Back just won't close it */ }
        el.hidden = false;
        document.documentElement.classList.add("g-viewer-open");
      }
      syncZoom();
      render();
      closeButton.focus({ preventScroll: true });
    }

    function hide() {
      if (!isOpen()) return;
      el.hidden = true;
      openId = null;
      preloads = [];
      img.removeAttribute("src");     // frees the big picture
      clearTimeout(toastTimer);
      toast.hidden = true;
      document.documentElement.classList.remove("g-viewer-open");
      if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    }

    // × goes Back, so the history entry added on open is used up; popstate hides.
    // Asked twice before Back lands = one Back (a second would leave the Gallery).
    function close() {
      if (!isOpen() || closing === generation) return;
      if (!(history.state && history.state.galleryViewer)) return hide();
      const mine = generation;
      closing = generation;
      history.back();
      setTimeout(() => { if (mine === generation) hide(); }, BACK_FALLBACK_MS);
    }

    self.addEventListener("popstate", hide);
    self.addEventListener("hashchange", hide);   // left the Gallery some other way

    /* ---------- gestures and keys ---------- */

    // Pinch-zoomed in: one finger moves around the photo (is-zoomed lets the browser pan)
    // instead of changing it; the arrows still change it.
    function zoomed() {
      return !!self.visualViewport && self.visualViewport.scale > 1;
    }

    function syncZoom() {
      stage.classList.toggle("is-zoomed", zoomed());
    }

    if (self.visualViewport) self.visualViewport.addEventListener("resize", syncZoom);

    stage.addEventListener("pointerdown", (e) => {
      pointers.add(e.pointerId);
      syncZoom();
      // Two fingers = zoom, not swipe.
      swipeFrom = pointers.size === 1 && !zoomed() ? { x: e.clientX, y: e.clientY } : null;
    });
    el.addEventListener("pointerup", (e) => {
      pointers.delete(e.pointerId);
      const from = swipeFrom;
      swipeFrom = null;
      if (!from || zoomed()) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dx) > G.swipeMinPx && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    });
    el.addEventListener("pointercancel", (e) => {
      pointers.delete(e.pointerId);
      swipeFrom = null;
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    });

    store.subscribe(render);

    return { el, open, close, isOpen };
  }

  W.viewViewer = { create };
})();
