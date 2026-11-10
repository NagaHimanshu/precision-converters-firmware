/* "Ready to share" bottom panel: the picked photos (× takes one out, ＋ More picks
   again), the guest's name, one Upload button, and the small "or use my Google name"
   link (which becomes Google's button when tapped) with a small Privacy link. Also the shared Remove / Keep
   question. The phone's Back closes the panel (it adds one history entry while open). */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});

  let ids = 0;   // unique element ids when more than one panel exists (tests)

  // If the Back that close() asked for never arrives (it always should), stop waiting after this long.
  const BACK_FALLBACK_MS = 800;

  // signIn (only when Google sign-in is on): { mountButton(el) } puts Google's button in el.
  function create({ ctx, identity, onUpload, signIn }) {
    const { text, h, fill, icon } = ctx;
    const G = ctx.cfg.gallery;
    const uid = "g-panel-" + ++ids;
    let chosen = [];             // { file, el, img, url, tried }
    let run = 0;                 // bumps on close; previews from an older run are dropped
    let making = false;          // previews are being made
    let backLanded = null;       // set while close()'s Back is on its way; that popstate is ours
    let scrollMode = null;       // the page's scroll restoration, while the panel turns it off
    let lastFocus = null;
    let answer = null;           // resolves the open Remove / Keep question
    let askedFrom = null;        // focus before the question, given back after it

    const input = h("input", { type: "file", accept: "image/*", multiple: "", class: "g-file",
      tabindex: "-1", "aria-hidden": "true", onchange: picked });

    const thumbs = h("div", { class: "g-p-thumbs" });
    const moreButton = h("button", { type: "button", class: "g-p-more", "data-g": "panel-more", onclick: () => pick() },
      h("span", { class: "g-p-plus", "aria-hidden": "true" }, "＋"), h("span", null, text.panelMore));
    const tooMany = h("p", { class: "g-p-note", "data-g": "panel-too-many", hidden: "" });
    const nameInput = h("input", { type: "text", id: uid + "-name", class: "g-p-input", "data-g": "name",
      maxlength: String(G.nameMaxLength), autocomplete: "name", enterkeyhint: "done",
      oninput: () => showHint(), onfocus: () => onNameFocus(),
      onkeydown: (e) => { if (e.key === "Enter") nameInput.blur(); } });
    const hint = h("p", { class: "g-p-hint" });
    const nameBox = h("div", { class: "g-p-name" },
      h("label", { for: uid + "-name" }, text.nameLabel + " ", h("span", { class: "g-p-optional" }, text.nameOptional)),
      nameInput, hint);
    const uploadButton = h("button", { type: "button", class: "g-p-upload", "data-g": "panel-upload", onclick: () => upload() },
      text.uploadButton);
    // Only with sign-in on. Tapped: replaced by Google's button (made once; stays for later opens).
    const googleOn = !!(G.googleClientId && signIn);
    const googleLink = h("button", { type: "button", class: "g-p-google", "data-g": "use-google",
      onclick: () => useGoogle() }, text.useGoogleName);
    const googleBox = h("div", { class: "g-signin g-p-signin", "data-g": "signin" });
    // The small Privacy link sits next to it (and stays under Google's button). It opens in a
    // new tab, so the photos just picked aren't lost.
    const privacyLink = h("a", { class: "g-privacy", "data-g": "privacy-link", href: G.privacyUrl,
      target: "_blank", rel: "noopener" }, text.privacyLink);
    const googleSpot = h("div", { class: "g-p-googlespot" }, googleOn ? [googleLink, privacyLink] : "");
    const closeButton = h("button", { type: "button", class: "g-p-close", "data-g": "panel-close",
      "aria-label": text.close, onclick: () => close() }, "×");
    const sheet = h("div", { class: "g-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": uid + "-title" },
      h("div", { class: "g-p-grab", "aria-hidden": "true" }),
      h("div", { class: "g-p-head" }, h("h2", { id: uid + "-title" }, text.panelTitle), closeButton),
      thumbs, tooMany, nameBox, uploadButton, googleSpot);
    const panel = h("div", { class: "g-panel", "data-g": "panel", hidden: "" }, h("div", { class: "g-dim" }), sheet);

    const question = h("p", { class: "g-c-text", id: uid + "-q" });
    const keepButton = h("button", { type: "button", class: "btn btn-outline g-c-keep", "data-g": "confirm-keep",
      onclick: () => settle(false) }, text.confirmKeep);
    const removeButton = h("button", { type: "button", class: "btn g-c-remove", "data-g": "confirm-remove",
      onclick: () => settle(true) }, text.confirmRemove);
    const dialog = h("div", { class: "g-confirm", "data-g": "confirm", hidden: "" }, h("div", { class: "g-dim" }),
      h("div", { class: "g-c-box", role: "alertdialog", "aria-modal": "true", "aria-labelledby": uid + "-q" },
        question, h("div", { class: "g-c-actions" }, keepButton, removeButton)));

    const el = h("div", { class: "g-panel-root" }, input, panel, dialog);

    /* ---------- picking ---------- */

    function pick() {
      input.value = "";
      input.click();
    }

    function picked() {
      const files = Array.from(input.files || []);
      input.value = "";                     // the same photo can be picked again later
      if (!files.length) return;
      if (isOpen()) add(files);
      else open(files);
    }

    function add(files) {
      for (const file of files) {
        if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) continue;
        const c = { file, url: null, tried: false };
        c.img = h("img", { alt: "", decoding: "async" });
        c.el = h("div", { class: "g-p-thumb", "data-g": "panel-thumb" }, c.img, icon("gallery"),
          h("button", { type: "button", class: "g-p-remove", "data-g": "panel-remove", "aria-label": text.panelRemove,
            onclick: () => takeOut(c) }, h("span", { "aria-hidden": "true" }, "×")));
        chosen.push(c);
      }
      renderThumbs();
    }

    function takeOut(c) {
      chosen = chosen.filter((x) => x !== c);
      if (c.url) URL.revokeObjectURL(c.url);
      renderThumbs();
    }

    function renderThumbs() {
      const max = G.maxPhotosPerUpload;
      moreButton.hidden = chosen.length >= max;
      thumbs.replaceChildren(...chosen.slice(0, max).map((c) => c.el), moreButton);
      tooMany.hidden = chosen.length <= max;
      tooMany.textContent = fill(text.tooMany, { max });
      uploadButton.disabled = !chosen.length;
      makePreviews();
    }

    // Small pictures for the chosen photos, one at a time (each needs a full decode).
    async function makePreviews() {
      if (making) return;
      making = true;
      const mine = run;
      try {
        for (;;) {
          const c = chosen.slice(0, G.maxPhotosPerUpload).find((x) => !x.tried);
          if (!c || mine !== run) return;
          c.tried = true;
          try {
            const r = await W.image.toJpeg(c.file, { maxLongEdgePx: G.previewSizePx, jpegQuality: G.jpegQuality });
            if (mine !== run || !chosen.includes(c)) continue;
            c.url = URL.createObjectURL(r.blob);
            c.img.src = c.url;
            c.el.classList.add("has-preview");
          } catch (e) {
            c.el.classList.add("is-broken");    // soft placeholder; the uploader will say so too
          }
        }
      } finally {
        if (mine === run) making = false;
      }
    }

    /* ---------- name ---------- */

    function showHint() {
      const name = nameInput.value.trim();
      hint.textContent = name ? fill(text.nameHint, { name }) : "";
      hint.hidden = !name;
    }

    // Keep the name box in sight above the on-screen keyboard.
    function fitKeyboard() {
      const vv = self.visualViewport;
      if (!vv || !isOpen()) return;
      const covered = Math.max(0, self.innerHeight - vv.height - vv.offsetTop);
      sheet.style.bottom = covered + "px";
      sheet.style.maxHeight = vv.height + "px";
      if (document.activeElement === nameInput) nameInput.scrollIntoView({ block: "center" });
    }

    function onNameFocus() {
      if (!self.visualViewport) nameInput.scrollIntoView({ block: "center" });
    }

    if (self.visualViewport) {
      self.visualViewport.addEventListener("resize", fitKeyboard);
      self.visualViewport.addEventListener("scroll", fitKeyboard);
    }

    /* ---------- Google sign-in ---------- */

    function useGoogle() {
      if (!googleOn || googleBox.isConnected) return;
      googleSpot.replaceChildren(googleBox, privacyLink);
      signIn.mountButton(googleBox);
    }

    // Signed in or out (here, on Photos by me, or as the server says): the name box and
    // sign-in follow. An account without a name keeps the name box (else uploads go nameless).
    function syncAccount() {
      const account = identity.account();
      nameBox.hidden = !!(account && account.name);
      googleSpot.hidden = !!account || !googleOn;
    }

    /* ---------- open / close ---------- */

    function isOpen() {
      return !panel.hidden;
    }

    function open(files) {
      if (!isOpen()) {
        lastFocus = document.activeElement;
        nameInput.value = identity.name();
        syncAccount();
        showHint();
        try {
          // Going Back to the Gallery entry must not put the old scroll position back
          // (it would undo the scroll that shows the new uploads); set on that entry first.
          scrollMode = history.scrollRestoration;
          history.scrollRestoration = "manual";
          history.pushState({ galleryPanel: true }, "");
        } catch (e) { /* Back just won't close it */ }
        panel.hidden = false;
        document.documentElement.classList.add("g-panel-open");
        fitKeyboard();
      }
      add(files || []);
      uploadButton.focus({ preventScroll: true });
    }

    function hide() {
      if (!isOpen()) return;
      run++;
      making = false;
      for (const c of chosen) if (c.url) URL.revokeObjectURL(c.url);
      chosen = [];
      thumbs.replaceChildren();
      panel.hidden = true;
      sheet.style.bottom = "";
      sheet.style.maxHeight = "";
      document.documentElement.classList.remove("g-panel-open");
      if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    }

    // Resolves once the Back it asks for has landed (or straight away if none was needed).
    function close() {
      if (!isOpen()) return Promise.resolve();
      const ours = history.state && history.state.galleryPanel;
      hide();
      if (!ours) return Promise.resolve();
      return new Promise((resolve) => {
        const landed = () => {
          if (backLanded === landed) backLanded = null;
          restoreScrollMode();
          resolve();
        };
        backLanded = landed;
        history.back();
        setTimeout(landed, BACK_FALLBACK_MS);
      });
    }

    function restoreScrollMode() {
      if (!scrollMode) return;
      try { history.scrollRestoration = scrollMode; } catch (e) { /* nothing to put back */ }
      scrollMode = null;
    }

    function upload() {
      if (!chosen.length) return;
      const files = chosen.map((c) => c.file);
      const name = nameBox.hidden ? identity.name() : nameInput.value.trim();
      onUpload(files, name, close());
    }

    // Back (or leaving the Gallery) while Remove / Keep is asked = Keep.
    self.addEventListener("popstate", () => {
      settle(false);
      if (backLanded) backLanded();
      else {
        hide();
        restoreScrollMode();
      }
    });
    self.addEventListener("hashchange", () => {   // left the Gallery some other way
      settle(false);
      hide();
      restoreScrollMode();
    });

    /* ---------- Remove / Keep ---------- */

    function settle(yes) {
      if (!answer) return;
      const done = answer;
      answer = null;
      dialog.hidden = true;
      if (askedFrom && askedFrom.isConnected) askedFrom.focus({ preventScroll: true });
      askedFrom = null;
      done(yes);
    }

    function confirm(q) {
      settle(false);                          // only one question at a time
      askedFrom = document.activeElement;
      question.textContent = q;
      dialog.hidden = false;
      keepButton.focus({ preventScroll: true });
      return new Promise((resolve) => { answer = resolve; });
    }

    el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!dialog.hidden) settle(false);
      else close();
    });

    return { el, pick, open, close, confirm, syncAccount };
  }

  W.viewPanel = { create };
})();
