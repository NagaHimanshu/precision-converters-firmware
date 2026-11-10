/* Gallery module entry: WeddingGallery.mount(container, ctx) -> { show, hide, update, destroy }.
   Loaded on demand by app.js. Other gallery files add their parts to WeddingGallery;
   this one wires them together. */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});

  W.mount = function mount(container, ctx) {
    const G = ctx.cfg.gallery;
    container.classList.add("gallery-root");
    container.style.setProperty("--gallery-add-width", G.addButtonWidth);

    // The Sheet's pause switch (app.js passes it in); the server's own answer is in the store.
    let sheetOpen = ctx.uploadsOpen !== false;
    function setUploadsOpen(open) {
      sheetOpen = open !== false;
      container.dataset.uploadsOpen = String(sheetOpen);
    }
    setUploadsOpen(ctx.uploadsOpen);

    const api = W.api.create({
      endpoint: G.endpoint,
      requestTimeoutMs: G.requestTimeoutMs,
      uploadTimeoutMs: G.uploadTimeoutMs,
      retries: G.retries,
      retryBackoffMs: G.retryBackoffMs,
    });
    const identity = W.identity.create({ storageGet: ctx.storageGet, storageSet: ctx.storageSet,
      api, getStore: () => store });
    const store = W.store.create({ api, identity, cfg: G, storageGet: ctx.storageGet, storageSet: ctx.storageSet });
    const signIn = G.googleClientId ? googleSignIn() : null;

    // Not tied to the screen: uploads keep going while the guest is elsewhere in the site.
    const uploader = W.uploader.create({
      api, identity, image: W.image, cfg: G, store,
      onChange: () => grid.render(store.state),
    });
    // closed: resolves once the panel's Back has landed (that Back would undo an earlier scroll).
    const panel = W.viewPanel.create({ ctx, identity, signIn, onUpload: (files, name, closed) => {
      grid.reveal(closed);
      uploader.add(files, name);
    } });

    // Delete (a tile of Photos by me, or the viewer): Remove / Keep first; only Remove sends it.
    // The store then takes the photo out of both tabs, and the viewer closes if it showed it.
    function askDelete(id) {
      return panel.confirm(ctx.text.confirmTitle).then((yes) => (yes ? store.deletePhoto(id) : undefined));
    }

    container.replaceChildren();
    const viewer = W.viewViewer.create({ ctx, store, onDelete: askDelete });
    const grid = W.viewGrid.create(container, {
      ctx, store, uploader,
      sheetOpen: () => sheetOpen,
      onOpen: (index) => viewer.open(index),
      onAdd: () => panel.pick(),
      onTab: (tab) => store.load(tab),
      onDelete: askDelete,
      signIn,
    });
    container.append(viewer.el, panel.el);

    // Optional Google sign-in (Photos by me card, and the panel's "or use my Google name").
    // Google's script loads the first time one of them is shown; if it can't (an app's
    // built-in browser, Google down), that spot says so and nothing else changes.
    function googleSignIn() {
      const { h, text } = ctx;

      function signedIn(token, status) {
        status.hidden = true;
        identity.signIn(token).then(() => panel.syncAccount(), (e) => {
          console.warn("Gallery sign-in failed:", e);
          status.textContent = W.errors.message(e && e.code === "offline" ? "offline" : "signin_failed");
          status.hidden = false;
        });
      }

      return {
        mountButton(el) {
          const button = h("div", { class: "g-gbutton" });
          const status = h("p", { class: "g-signin-status", "data-g": "signin-failed", role: "status", hidden: "" });
          el.replaceChildren(button, status);
          W.identity.loadGoogle({ googleScriptUrl: G.googleScriptUrl, scriptLoadTimeoutMs: G.scriptLoadTimeoutMs })
            .then(() => W.identity.renderGoogleButton(button, {
              clientId: G.googleClientId,
              onCredential: (token) => signedIn(token, status),
            }))
            .catch((e) => {
              console.warn("Gallery: Google sign-in unavailable:", e);
              el.replaceChildren(h("p", { class: "g-signin-status", "data-g": "signin-unavailable", role: "status" },
                text.signInUnavailable));
            });
        },
        // Rejects when the server couldn't be told (the grid says so; nothing changes).
        signOut() {
          return identity.signOut().then(() => panel.syncAccount());
        },
      };
    }
    store.subscribe(grid.render);
    grid.render(store.state);
    // The server's answer about the account (kept by the store on the phone) also sets the panel.
    let account = store.state.account;
    store.subscribe((state) => {
      if (JSON.stringify(state.account) === JSON.stringify(account)) return;
      account = state.account;
      panel.syncAccount();
    });

    let started = false;
    let timer = null;

    // New photos, and another go at pictures that didn't load.
    function refresh() {
      grid.retryThumbs();
      store.refresh();
    }

    function tick() {
      if (document.visibilityState === "visible") refresh();
    }

    // Coming back to the phone: look for new photos straight away.
    function onVisible() {
      if (timer && document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    return {
      show() {
        if (!started) {
          started = true;
          store.load("all");
        } else {
          refresh();
        }
        if (!timer) timer = setInterval(tick, G.refreshIntervalMs);
      },
      hide() {
        clearInterval(timer);
        timer = null;
        panel.close();       // uploads already started carry on
      },
      update(partial) {
        if (partial && partial.uploadsOpen !== undefined) {
          setUploadsOpen(partial.uploadsOpen);
          grid.render(store.state);
        }
      },
      // This copy failed and app.js mounts a fresh one: stop looking for photos.
      // Uploads already started carry on (they land on the server either way).
      destroy() {
        clearInterval(timer);
        timer = null;
        document.removeEventListener("visibilitychange", onVisible);
        panel.close();
      },
    };
  };
})();
