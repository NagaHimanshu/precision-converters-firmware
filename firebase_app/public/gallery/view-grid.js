/* Gallery main screen: subtitle, All / Mine switch, the photo grid with hearts (and
   Delete on each tile of Photos by me), calm cards (loading, can't load, offline, empty),
   the pinned Add photos button (or the paused / album-full note instead), photos being
   uploaded, a calm line when a delete didn't work, and the Google sign-in card at the
   bottom of Photos by me. */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});

  // Heart symbols; U+FE0E asks for the plain (colourable) form, not an emoji.
  const HEART_ON = String.fromCharCode(0x2665, 0xFE0E);
  const HEART_OFF = String.fromCharCode(0x2661);
  // Added to a grid picture's address when it is asked for again, so no failed copy is reused.
  const RETRY_PARAM = "retry";

  // uploader (optional): the upload queue; sheetOpen(): the Sheet's pause switch says open;
  // onDelete(id): a tile's Delete was tapped (the caller asks Remove / Keep first).
  // signIn (only when Google sign-in is on): { mountButton(el): put Google's button in el
  // (loads Google's script), signOut(): Promise }.
  function create(root, { ctx, store, uploader, sheetOpen, onOpen, onAdd, onTab, onDelete, signIn }) {
    const { text, h, fill, icon } = ctx;
    const G = ctx.cfg.gallery;
    let current = store.state;
    const tiles = new Map();      // photo id -> tile parts, reused across renders
    const upTiles = new Map();    // upload key -> tile parts

    const subtitle = h("p", { class: "g-subtitle", "data-g": "subtitle", hidden: "" });
    const tabAll = h("button", { type: "button", class: "g-tab", "data-g": "tab-all", onclick: () => pick("all") }, text.tabAll);
    const tabMine = h("button", { type: "button", class: "g-tab", "data-g": "tab-mine", onclick: () => pick("mine") }, text.tabMine);
    const notice = h("div", { class: "g-notice-box" });
    const upLine = h("div", { class: "g-upline-box" });   // uploading line, delete failure line
    const upNote = h("div", { class: "g-upnote-box" });   // paused / full: in Add photos' place
    const stateBox = h("div", { class: "g-state-box" });
    const grid = h("div", { class: "g-grid", "data-g": "grid" });
    const more = h("div", { class: "g-more" });
    const sentinel = h("div", { class: "g-sentinel", "data-g": "sentinel", "aria-hidden": "true" });
    // Under the grid of Photos by me: "Shared photos from another phone?" + Google's button,
    // or "Signed in as {name}" + Sign out. Both stay in place (hidden), so Google's button
    // is made once and never reloaded.
    const signInSpot = h("div", { class: "g-signin-spot", "data-g": "signin-spot", hidden: "" });
    const signInBox = h("div", { class: "g-signin", "data-g": "signin" });
    const signedOutCard = h("div", { class: "g-signin-card", "data-g": "signin-card" },
      h("p", { class: "g-signin-title" }, text.otherPhoneTitle), signInBox,
      h("p", { class: "g-signin-note" }, text.signInNote));
    const signedInLine = h("p", { class: "g-signin-title", "data-g": "signed-in" });
    const signOutButton = h("button", { type: "button", class: "btn btn-outline g-signout", "data-g": "signout",
      onclick: () => signOutNow() }, text.signOut);
    const signOutFailed = h("p", { class: "g-signin-status", "data-g": "signout-failed", role: "status", hidden: "" },
      text.signOutFailed);
    const signedInCard = h("div", { class: "g-signin-card", "data-g": "signin-card" }, signedInLine, signOutButton,
      signOutFailed);
    let buttonMounted = false;
    if (signIn) signInSpot.append(signedOutCard, signedInCard);
    const addButton = h("button", { type: "button", class: "g-add", "data-g": "add", onclick: () => onAdd() }, text.addPhotos);
    const addBar = h("div", { class: "g-addbar" }, addButton, upNote);
    let revealing = false;        // the next render shows newly added uploads at the top
    root.append(subtitle, upLine, h("div", { class: "g-tabs" }, tabAll, tabMine), notice, stateBox,
      grid, more, signInSpot, sentinel, addBar);

    function pick(tab) {
      if (tab !== current.tab) onTab(tab);
    }

    function tryAgain() {
      return h("button", { type: "button", class: "btn", "data-g": "try-again", onclick: () => store.load(current.tab) }, text.tryAgain);
    }

    function card(title, body, ...extra) {
      return h("div", { class: "coming-soon g-card", "data-g": "state" }, icon("gallery"),
        h("h3", null, title), h("p", null, body), ...extra);
    }

    /* ---------- tiles ---------- */

    function thumbSrc(id, tries) {
      const url = fill(G.thumbUrl, { id: encodeURIComponent(id), size: G.thumbSizePx });
      return tries ? url + (url.includes("?") ? "&" : "?") + RETRY_PARAM + "=" + tries : url;
    }

    // waiting: the real picture isn't shown yet (it failed, or the tile shows the small copy
    // of a photo shared from this phone this visit). tries: times it was asked for again.
    function makeTile(p) {
      const parts = { id: p.id, waiting: false, tries: 0, probing: false };
      parts.preview = uploader && uploader.preview ? uploader.preview(p.id) : null;
      parts.img = h("img", {
        alt: "", loading: "lazy", decoding: "async",
        onerror: () => {
          parts.waiting = true;
          parts.el.classList.add("is-broken");
        },
        src: parts.preview || thumbSrc(p.id, 0),
      });
      parts.open = h("button", { type: "button", class: "g-open" }, parts.img, icon("gallery"));
      parts.glyph = h("span", { class: "g-glyph", "aria-hidden": "true" });
      parts.count = h("span", { class: "g-count" });
      parts.heart = h("button", { type: "button", class: "g-heart", "data-g": "heart", "aria-label": text.heartLabel },
        h("span", { class: "g-pill" }, parts.glyph, parts.count));
      // Only on Photos by me; added to the tile there (see updateTile).
      parts.del = h("button", { type: "button", class: "g-del", "data-g": "tile-delete" },
        h("span", { class: "g-pill" }, text.delete));
      parts.el = h("div", { class: "g-tile", "data-g": "tile", "data-id": p.id }, parts.open, parts.heart);
      if (parts.preview) {
        parts.waiting = true;
        probe(parts);
      }
      parts.el.addEventListener("click", (e) => {
        if (e.target.closest('[data-g="tile-delete"]')) {
          if (!parts.del.disabled && onDelete) onDelete(p.id);
        } else if (e.target.closest('[data-g="heart"]')) store.toggleHeart(p.id);
        else {
          const i = current.photos.findIndex((x) => x.id === p.id);
          if (i >= 0) onOpen(i);
        }
      });
      return parts;
    }

    // Asks for the real picture out of sight; only one that arrived replaces what is shown.
    function probe(t) {
      const src = thumbSrc(t.id, t.tries);
      const im = new Image();
      t.probing = true;
      im.onload = () => {
        t.probing = false;
        t.waiting = false;
        t.img.src = src;
        t.el.classList.remove("is-broken");
        if (t.preview) {
          uploader.previewDone(t.id);
          t.preview = null;
        }
      };
      im.onerror = () => { t.probing = false; };
      im.src = src;
    }

    // Called on each refresh: pictures not shown yet are asked for again, at most
    // G.thumbRetries times each; after that a broken one stays a soft placeholder.
    function retryThumbs() {
      for (const t of tiles.values()) {
        if (!t.waiting || t.probing || t.tries >= G.thumbRetries) continue;
        t.tries++;
        probe(t);
      }
    }

    function updateTile(t, p, i, state) {
      const total = state.total;
      const canDelete = state.tab === "mine" && p.mine;
      const deleting = (state.deleting || []).includes(p.id);
      if (canDelete && !t.del.parentNode) t.el.append(t.del);
      else if (!canDelete && t.del.parentNode) t.del.remove();
      t.del.disabled = deleting;
      t.el.classList.toggle("is-deleting", deleting);
      t.open.setAttribute("aria-label", fill(text.counter, { n: i + 1, total }));
      t.heart.setAttribute("aria-pressed", String(p.hearted));
      t.heart.classList.toggle("is-on", p.hearted);
      t.glyph.textContent = p.hearted ? HEART_ON : HEART_OFF;
      t.count.textContent = String(p.hearts);
    }

    // The first tile still on screen, so new photos added above don't move what the guest sees.
    function anchorTile() {
      if (!(self.scrollY > 0)) return null;
      for (const el of grid.children) if (el.getBoundingClientRect().bottom > 0) return el;
      return null;
    }

    function placeTiles(nodes, keepPlace) {
      const kids = grid.children;
      let same = kids.length <= nodes.length;
      for (let i = 0; same && i < kids.length; i++) same = kids[i] === nodes[i];
      if (same && kids.length === nodes.length) return;
      if (same) return grid.append(...nodes.slice(kids.length));
      const anchor = keepPlace ? anchorTile() : null;
      const before = anchor && anchor.getBoundingClientRect().top;
      grid.replaceChildren(...nodes);
      if (anchor && anchor.isConnected) {
        const moved = anchor.getBoundingClientRect().top - before;
        if (moved) self.scrollBy(0, moved);
      }
    }

    /* ---------- photos being uploaded ---------- */

    function makeUpTile(key) {
      const parts = {};
      parts.img = h("img", { alt: "", decoding: "async" });
      parts.ring = h("div", { class: "g-ring" });
      parts.busy = h("div", { class: "g-up-busy" }, parts.ring);
      parts.failed = h("button", { type: "button", class: "g-up-failed" });
      parts.el = h("div", { class: "g-tile g-up", "data-key": key }, parts.img, parts.busy, parts.failed);
      parts.el.addEventListener("click", () => { if (parts.el.dataset.g === "failed-tile") tapFailed(key); });
      return parts;
    }

    function tapFailed(key) {
      const item = uploader.items().find((i) => i.key === key);
      if (!item) return;
      if (item.code === "unsupported" && uploader.dismiss) uploader.dismiss(key);   // trying again can't help
      else uploader.retry(key);
    }

    function updateUpTile(t, item) {
      const failed = item.status === "failed";
      t.el.dataset.g = failed ? "failed-tile" : "uploading-tile";
      if (item.previewUrl && t.img.getAttribute("src") !== item.previewUrl) t.img.setAttribute("src", item.previewUrl);
      t.img.hidden = !item.previewUrl;
      t.busy.hidden = failed;
      t.failed.hidden = !failed;
      if (failed) t.failed.textContent = item.code === "unsupported" ? text.unsupported : text.uploadFailed;
      else t.ring.style.setProperty("--p", String(Math.round(item.progress * 100)));
    }

    function uploadNodes() {
      const items = uploader ? uploader.items().filter((i) => i.status !== "done") : [];
      const seen = new Set();
      const nodes = items.map((item) => {
        let t = upTiles.get(item.key);
        if (!t) upTiles.set(item.key, (t = makeUpTile(item.key)));
        updateUpTile(t, item);
        seen.add(item.key);
        return t.el;
      });
      for (const key of upTiles.keys()) if (!seen.has(key)) upTiles.delete(key);
      return nodes;
    }

    // Kept in sight while scrolling: the uploading line, and why a delete didn't work.
    function renderUpLine(state) {
      const c = uploader && uploader.busy() ? uploader.counts() : null;
      const failed = state.deleteError;
      upLine.replaceChildren(
        c ? h("div", { class: "g-upline", "data-g": "uploading", role: "status" },
          h("p", null, fill(text.uploading, { done: Math.min(c.total, c.finished + 1), total: c.total })),
          h("p", { class: "g-keep-open" }, text.keepOpen),
          c.dropped > 0 ? h("p", { "data-g": "too-many" }, fill(text.tooMany, { max: G.maxPhotosPerUpload })) : "") : "",
        failed ? h("p", { class: "g-status", "data-g": "delete-failed", role: "status" }, W.errors.message(failed.code)) : "");
    }

    // Paused (Sheet switch or server) or album full: a soft note instead of Add photos.
    function renderUpNote(state, canAdd) {
      const open = state.uploadsOpen && (!sheetOpen || sheetOpen());
      const shown = canAdd && (state.full || !open);
      upNote.replaceChildren(!shown ? ""
        : state.full
          ? h("div", { class: "g-upnote", "data-g": "full" }, h("p", null, text.fullNote),
            h("button", { type: "button", class: "btn btn-outline", "data-g": "full-action", onclick: () => ctx.goContacts() }, text.fullAction))
          : h("div", { class: "g-upnote", "data-g": "paused" }, h("p", null, text.pausedNote)));
      return canAdd && !shown;
    }

    /* ---------- Google sign-in card ---------- */

    function renderSignIn(state) {
      const shownNow = !!signIn && state.tab === "mine" && state.status === "ready" && !state.fromSaved;
      signInSpot.hidden = !shownNow;
      if (!shownNow) return;
      const account = state.account;
      if (!account) signOutFailed.hidden = true;
      signedInCard.hidden = !account;
      signedOutCard.hidden = !!account;
      if (account) signedInLine.textContent = account.name ? fill(text.signedInAs, { name: account.name }) : text.signedInNoName;
      else if (!buttonMounted) {
        buttonMounted = true;   // Google's script loads now, the first time the card is seen
        signIn.mountButton(signInBox);
      }
    }

    // A sign-out that didn't reach the server leaves the guest signed in, and says so.
    function signOutNow() {
      if (signOutButton.disabled) return;
      signOutButton.disabled = true;
      signOutFailed.hidden = true;
      let done;
      try { done = Promise.resolve(signIn.signOut()); } catch (e) { done = Promise.reject(e); }
      done.catch((e) => {
        console.warn("Gallery sign-out failed:", e);
        signOutFailed.hidden = false;
      }).then(() => { signOutButton.disabled = false; });
    }

    /* ---------- more photos while scrolling ---------- */

    function nearEnd() {
      const s = current;
      if (!s.next || s.status !== "ready" || s.error || s.fromSaved) return;
      if (!sentinel.isConnected || sentinel.offsetParent === null) return;   // screen not shown
      if (sentinel.getBoundingClientRect().top < self.innerHeight + G.loadMoreAheadPx) store.loadMore();
    }

    if ("IntersectionObserver" in self) {
      new IntersectionObserver(nearEnd, { rootMargin: "0px 0px " + G.loadMoreAheadPx + "px 0px" }).observe(sentinel);
    } else {
      self.addEventListener("scroll", nearEnd, { passive: true });
    }

    /* ---------- render ---------- */

    function render(state) {
      current = state;
      const ready = state.status === "ready";
      const uploads = uploadNodes();
      const none = !state.photos.length && !uploads.length;

      if (ready) {
        subtitle.textContent = state.tab === "mine" ? text.mineSubtitle
          : state.total === 1 ? text.subtitleOne
          : fill(text.subtitle, { count: state.total.toLocaleString(ctx.locale) });
        subtitle.hidden = none && state.tab === "all";   // no "0 photos" line above the empty card
      }
      tabAll.setAttribute("aria-pressed", String(state.tab === "all"));
      tabMine.setAttribute("aria-pressed", String(state.tab === "mine"));

      notice.replaceChildren(state.fromSaved
        ? h("p", { class: "g-notice", "data-g": "saved" }, h("span", null, text.savedNotice), tryAgain())
        : "");

      const offline = state.error === "offline";
      stateBox.replaceChildren(
        !none ? ""
          : state.status === "error"
            ? card(offline ? text.offlineTitle : text.errorTitle, offline ? text.offlineBody : text.errorBody, tryAgain())
            : ready ? card(text.emptyTitle, state.tab === "mine" ? text.mineEmpty : text.emptyBody)
            : h("p", { class: "message", "data-g": "loading" }, text.loading));

      const seen = new Set();
      const nodes = state.photos.map((p, i) => {
        let t = tiles.get(p.id);
        if (!t) tiles.set(p.id, (t = makeTile(p)));
        updateTile(t, p, i, state);
        seen.add(p.id);
        return t.el;
      });
      for (const id of tiles.keys()) if (!seen.has(id)) tiles.delete(id);
      placeTiles(uploads.concat(nodes), !revealing);
      revealing = false;
      renderUpLine(state);

      more.replaceChildren(ready && state.error && state.next && !state.fromSaved
        ? h("button", { type: "button", class: "btn btn-outline", "data-g": "more-again", onclick: () => store.loadMore() }, text.tryAgain)
        : "");

      renderSignIn(state);
      const canAdd = ready && !state.fromSaved;
      addButton.hidden = !renderUpNote(state, canAdd);
      addBar.hidden = !canAdd;
      setTimeout(nearEnd, 0);
    }

    // Photos were just added: their tiles and the uploading line go on top, and the guest is
    // taken there once `settled` (the panel's Back) resolves, so a scrolled-down guest sees them.
    function reveal(settled) {
      revealing = true;
      Promise.resolve(settled).then(() => {
        if (root.isConnected && root.offsetParent !== null) self.scrollTo({ top: 0, behavior: "smooth" });
      });
    }

    return { render, reveal, retryThumbs };
  }

  W.viewGrid = { create };
})();
