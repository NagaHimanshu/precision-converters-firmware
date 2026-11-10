/* Privacy page (privacy.html). Contains no wording: everything comes from text.privacy in
   site-config.js. Needs no Sheet, so it always opens. */
(function () {
  "use strict";

  const CFG = self.SITE_CONFIG;
  const T = CFG.text;
  const P = T.privacy;

  // Same element helper as app.js: text goes in as text, never as markup.
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false || kid === "") continue;
      node.append(kid instanceof Node ? kid : String(kid));
    }
    return node;
  }

  // Same as applyTheme in app.js.
  function applyTheme() {
    const root = document.documentElement.style;
    for (const [name, value] of Object.entries(CFG.theme.colors)) {
      root.setProperty("--" + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), value);
    }
    root.setProperty("--font-script", '"' + CFG.theme.fonts.script + '"');
    root.setProperty("--font-body", '"' + CFG.theme.fonts.body + '"');
    document.head.append(h("link", { rel: "stylesheet", href: CFG.theme.fonts.url }));
    document.querySelector('meta[name="theme-color"]').content = CFG.theme.colors.background;
  }

  // Opened from the site in this tab: Back goes back there. Opened directly or in a new tab
  // (the site's Privacy links): no page to go back to, so the link takes the guest home.
  function cameFromSite() {
    try {
      return history.length > 1 && new URL(document.referrer).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function contactButton() {
    return h("div", { class: "actions" },
      h("a", { class: "btn btn-outline", "data-g": "privacy-contacts", href: CFG.gallery.privacyContactsUrl }, P.contactLink));
  }

  function start() {
    applyTheme();
    document.title = P.title;
    const back = document.querySelector(".inner-header .back-btn");
    back.setAttribute("aria-label", T.back);
    back.addEventListener("click", (e) => {
      if (!cameFromSite()) return;
      e.preventDefault();
      history.back();
    });
    document.querySelector(".inner-header h2").textContent = P.title;
    document.getElementById("privacy-body").replaceChildren(
      h("p", { class: "privacy-intro", "data-g": "privacy-intro" }, P.intro),
      ...P.sections.map((s) => h("section", { class: "card", "data-g": "privacy-section" },
        h("h3", null, s.heading), (s.paragraphs || []).map((text) => h("p", null, text)),
        s.contact ? contactButton() : null)));
  }

  start();
})();
