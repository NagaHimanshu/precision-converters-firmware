/* Wedding site logic. Contains no wedding content: all text, links, images and
   colours come from site-config.js; all wedding data comes from the Google Sheet
   (or data/sample.json while no sheet is connected). */
(function () {
  "use strict";

  const CFG = self.SITE_CONFIG;
  const T = CFG.text;
  const COLS = CFG.sheet.columns;
  const CACHE_KEY = "site-data:" + (CFG.sheet.id || "sample");
  const HINT_KEY = "install-hint-dismissed";
  const REFRESH_AFTER_MS = 5 * 60 * 1000;

  // Columns a tab cannot work without; others are optional.
  const REQUIRED = {
    settings: ["key", "value"],
    program: ["date", "time", "event"],
    accommodation: ["name", "room"],
    locations: ["name"],
    contacts: ["name", "phone"],
  };

  let model = null;
  let lastFetch = 0;
  let navigatedInApp = false;
  let programScrolled = false;

  /* ---------- Small helpers ---------- */

  const $ = (id) => document.getElementById(id);

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  }

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

  function norm(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  // Links typed into the sheet are only used if they are web addresses.
  function safeUrl(url) {
    return /^https?:\/\//i.test(String(url || "").trim()) ? String(url).trim() : null;
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode: ignore */ }
  }

  /* ---------- Icons (decorative line art, no content) ---------- */

  const ICONS = {
    program: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 18.4s-3-1.8-3-3.7a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.9-3 3.7-3 3.7z"/>',
    stay: '<path d="M3 19V6M3 15h18v4M21 15v-2.5A3.5 3.5 0 0 0 17.5 9H11v6"/><circle cx="7" cy="11.5" r="1.8"/>',
    venues: '<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    gallery: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.8"/>',
    phone: '<path d="M5 4h3.5L10 8 7.8 9.4a11 11 0 0 0 6.8 6.8L16 14l4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    navigate: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
    whatsapp: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9.5 9.5c.3 2 2 4 5 5"/>',
  };

  const SPRIG =
    '<svg class="sprig" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 42C14 32 24 20 36 11"/>' +
    '<path d="M14 33q-7-1-9-6q6-1 9 6z"/><path d="M14 33q1-7 6-9q1 6-6 9z"/>' +
    '<path d="M23 23q-7-1-9-6q6-1 9 6z"/><path d="M23 23q1-7 6-9q1 6-6 9z"/>' +
    '<circle cx="39" cy="9" r="2"/><circle cx="39" cy="4.5" r="2.3"/><circle cx="43.3" cy="7.6" r="2.3"/>' +
    '<circle cx="41.6" cy="12.6" r="2.3"/><circle cx="36.4" cy="12.6" r="2.3"/><circle cx="34.7" cy="7.6" r="2.3"/></svg>';

  function icon(name) {
    const t = document.createElement("template");
    t.innerHTML =
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
    return t.content.firstElementChild;
  }

  /* ---------- Theme ---------- */

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

  /* ---------- Data loading ---------- */

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function objectsToRows(list) {
    const headers = [];
    for (const obj of list) for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
    return [headers, ...list.map((obj) => headers.map((k) => (obj[k] == null ? "" : String(obj[k]))))];
  }

  async function fetchRaw() {
    const tabs = CFG.sheet.tabs;
    const raw = {};
    if (!CFG.sheet.id) {
      const res = await fetch(CFG.sampleDataPath, { cache: "no-store" });
      if (!res.ok) throw new Error("sample " + res.status);
      const json = await res.json();
      for (const [key, tab] of Object.entries(tabs)) raw[key] = objectsToRows(json[tab] || []);
      return raw;
    }
    // Each tab loads on its own, so one broken tab doesn't take down the others.
    const results = await Promise.allSettled(Object.entries(tabs).map(async ([key, tab]) => {
      const url = fill(CFG.sheet.urlTemplate, {
        id: encodeURIComponent(CFG.sheet.id),
        tab: encodeURIComponent(tab),
      });
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(tab + " " + res.status);
      const text = await res.text();
      // A sign-in page instead of CSV means the sheet is not shared publicly.
      if (/^\s*</.test(text)) throw new Error(tab + " not shared");
      raw[key] = parseCSV(text);
    }));
    const failed = results.filter((r) => r.status === "rejected");
    failed.forEach((r) => console.warn("Tab failed:", r.reason));
    if (failed.length === results.length) throw failed[0].reason;
    return raw;
  }

  // Turns raw rows into records keyed by the site's field names.
  function toTable(rows, columns, required) {
    rows = rows || [];
    const header = (rows[0] || []).map(norm);
    const index = {};
    for (const [field, label] of Object.entries(columns)) index[field] = header.indexOf(norm(label));
    const ok = required.every((f) => index[f] >= 0);
    const records = [];
    if (ok) {
      for (const r of rows.slice(1)) {
        const rec = {};
        let any = false;
        for (const field of Object.keys(columns)) {
          const v = index[field] >= 0 ? String(r[index[field]] || "").trim() : "";
          rec[field] = v;
          if (v) any = true;
        }
        if (any) records.push(rec);
      }
    }
    return { ok, rows: records };
  }

  function buildModel(raw) {
    const m = {};
    for (const key of Object.keys(REQUIRED)) m[key] = toTable(raw[key], COLS[key], REQUIRED[key]);
    const values = {};
    for (const r of m.settings.rows) values[norm(r.key)] = r.value;
    const s = {};
    for (const [field, key] of Object.entries(CFG.sheet.settingKeys)) s[field] = values[norm(key)] || "";
    m.info = s;
    m.vars = { bride: s.bride, groom: s.groom, city: s.city };
    return m;
  }

  async function refresh() {
    lastFetch = Date.now();
    try {
      const fresh = await fetchRaw();
      // Tabs that failed this time keep their last saved copy.
      const raw = Object.assign({}, cachedRaw(), fresh);
      storageSet(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), raw }));
      model = buildModel(raw);
      renderAll();
      hideStatus();
    } catch (err) {
      console.warn("Data load failed:", err);
      if (model) showStatus(T.status.offline, 5000);
      else {
        // Nothing saved yet: still show the screens, each saying it is being updated.
        model = buildModel({});
        renderAll();
        showStatus(T.status.failed);
      }
    }
  }

  function cachedRaw() {
    try {
      return JSON.parse(storageGet(CACHE_KEY)).raw || {};
    } catch (e) {
      return {};
    }
  }

  function loadCached() {
    const raw = cachedRaw();
    if (!Object.keys(raw).length) return false;
    model = buildModel(raw);
    return true;
  }

  /* ---------- Dates & times ---------- */

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function makeDate(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
  }

  function parseDate(value) {
    const s = String(value || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return makeDate(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return CFG.sheet.dateOrder === "MDY" ? makeDate(y, +m[1], +m[2]) : makeDate(y, +m[2], +m[1]);
    }
    m = s.match(/^Date\((\d+),(\d+),(\d+)/);
    if (m) return makeDate(+m[1], +m[2] + 1, +m[3]);
    const mon = s.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
    const nums = s.match(/\d+/g) || [];
    const year = nums.find((n) => n.length === 4);
    const day = nums.find((n) => n.length <= 2);
    if (mon && year && day) return makeDate(+year, MONTHS.indexOf(mon[1]) + 1, +day);
    return null;
  }

  // Minutes after midnight, from "7:30 PM", "7 pm", "19:30" or "7:30:00 PM".
  function parseTime(value) {
    const m = String(value || "").trim().toLowerCase()
      .match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*([ap])?\.?\s*m?\.?/);
    if (!m) return null;
    let hour = +m[1];
    const min = +(m[2] || 0);
    if (m[3]) {
      const pm = m[3] === "p";
      if (hour === 12) hour = pm ? 12 : 0;
      else if (pm) hour += 12;
    }
    return hour > 23 || min > 59 ? null : hour * 60 + min;
  }

  function startOfToday() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function formatDate(date, withYear) {
    const opts = { weekday: "long", day: "numeric", month: "long" };
    if (withYear) opts.year = "numeric";
    return new Intl.DateTimeFormat(CFG.locale, opts).format(date);
  }

  /* ---------- Home ---------- */

  function renderHome() {
    const s = model.info;
    const v = model.vars;
    document.title = fill(T.pageTitle, v);

    const photo = $("hero-photo");
    if (photo.getAttribute("src") !== CFG.images.hero) photo.src = CFG.images.hero;
    photo.alt = fill(T.heroPhotoAlt, v);

    $("hero-names").replaceChildren(s.bride, h("span", { class: "joiner" }, T.heroJoiner), s.groom);

    const wedding = parseDate(s.weddingDate);
    $("hero-date").replaceChildren(
      wedding ? formatDate(wedding, true) : s.weddingDate,
      s.city ? h("br") : null,
      s.city
    );
    $("hero-tagline").textContent = s.tagline;

    const cd = $("hero-countdown");
    if (CFG.features.countdown && wedding) {
      const days = Math.round((wedding - startOfToday()) / 86400000);
      cd.textContent =
        days > 1 ? fill(T.countdownMany, { days }) :
        days === 1 ? T.countdownOne :
        days === 0 ? T.countdownToday : T.countdownPast;
      cd.hidden = false;
    } else cd.hidden = true;

    const tiles = ["program", "stay", "venues"];
    if (CFG.features.gallery) tiles.push("gallery");
    $("home-tiles").replaceChildren(
      ...tiles.map((name) => h("a", { class: "tile", href: "#" + name }, icon(name), T.tiles[name]))
    );

    const strip = $("home-contacts");
    strip.replaceChildren(icon("phone"), T.contactsStrip);
    strip.hidden = !(CFG.features.contacts && model.contacts.ok && model.contacts.rows.length);
  }

  /* ---------- Program ---------- */

  function mapLinksByVenue() {
    const links = {};
    if (model.locations.ok) {
      for (const loc of model.locations.rows) {
        const url = safeUrl(loc.mapLink);
        if (url) links[norm(loc.name)] = url;
      }
    }
    return links;
  }

  function renderProgram() {
    const body = $("program-body");
    const table = model.program;
    if (!table.ok) return body.replaceChildren(h("p", { class: "message" }, T.status.dataUpdating));
    if (!table.rows.length) return body.replaceChildren(h("p", { class: "message" }, T.program.empty));

    const events = table.rows.map((r, i) => {
      const day = parseDate(r.date);
      const minutes = parseTime(r.time);
      const start = day && minutes != null ? new Date(day.getTime() + minutes * 60000) : null;
      return { ...r, i, day, start, dayKey: day ? day.toDateString() : r.date };
    });
    events.sort((a, b) => {
      if (a.day && b.day && a.day - b.day) return a.day - b.day;
      if (a.start && b.start && a.start - b.start) return a.start - b.start;
      return a.i - b.i;
    });

    // Happening now / up next
    let nowEvent = null;
    let nextEvent = null;
    if (CFG.features.nowNext) {
      const now = Date.now();
      const timed = events.filter((e) => e.start);
      for (let k = 0; k < timed.length; k++) {
        const e = timed[k];
        if (e.start > now) { nextEvent = e; break; }
        const following = timed[k + 1];
        const end = Math.min(
          following ? following.start.getTime() : Infinity,
          e.start.getTime() + CFG.nowWindowHours * 3600000
        );
        if (now < end) nowEvent = e;
      }
    }

    const links = mapLinksByVenue();
    const groups = [];
    for (const e of events) {
      let g = groups[groups.length - 1];
      if (!g || g.key !== e.dayKey) groups.push((g = { key: e.dayKey, day: e.day, label: e.date, items: [] }));
      g.items.push(e);
    }

    const today = startOfToday().getTime();
    body.replaceChildren(...groups.map((g) =>
      h("section", { class: "day", "data-today": g.day && g.day.getTime() === today ? "1" : null },
        h("h3", { class: "day-title" }, g.day ? formatDate(g.day, false) : g.label),
        h("ol", { class: "timeline" }, g.items.map((e) => {
          const isNow = e === nowEvent;
          const isNext = e === nextEvent;
          const link = links[norm(e.venue)];
          return h("li", { class: "event" + (isNow ? " is-now" : "") + (isNext ? " is-next" : "") },
            h("div", { class: "event-time" }, e.time,
              isNow && h("span", { class: "badge badge-now" }, T.program.happeningNow),
              isNext && h("span", { class: "badge badge-next" }, T.program.upNext)),
            h("p", { class: "event-name" }, e.event),
            e.venue && h("p", { class: "event-venue" }, e.venue,
              link && h("a", { class: "map-link", href: link, target: "_blank", rel: "noopener" },
                icon("navigate"), T.program.openMap)),
            e.note && h("p", { class: "event-note" }, e.note));
        }))
      )
    ));
  }

  function scrollProgramToNow() {
    if (programScrolled) return;
    const target = document.querySelector("#program-body .is-now, #program-body .is-next");
    if (!target) return;
    // Only jump when the highlighted event is today; otherwise start at the top.
    if (target.closest(".day").dataset.today) {
      programScrolled = true;
      target.scrollIntoView({ block: "center" });
    }
  }

  /* ---------- Stay ---------- */

  let stayIndex = [];

  function prepareStay() {
    const rows = model.accommodation.ok ? model.accommodation.rows.slice() : [];
    const numeric = rows.every((r) => r.sno === "" || !isNaN(+r.sno));
    if (numeric) rows.sort((a, b) => (+a.sno || 0) - (+b.sno || 0));
    stayIndex = rows.map((r) => {
      const n = norm(r.name);
      return { r, n, compact: n.replace(/ /g, "") };
    });
  }

  function renderStay() {
    $("stay-search-label").textContent = T.stay.searchLabel;
    const input = $("stay-search");
    input.placeholder = T.stay.searchPlaceholder;
    const list = $("stay-list");
    const count = $("stay-count");

    if (!model.accommodation.ok) {
      count.textContent = "";
      return list.replaceChildren(h("li", { class: "message" }, T.status.dataUpdating));
    }
    if (!stayIndex.length) {
      count.textContent = "";
      return list.replaceChildren(h("li", { class: "message" }, T.stay.empty));
    }

    const tokens = norm(input.value).split(" ").filter(Boolean);
    const matches = stayIndex.filter((x) =>
      tokens.every((t) => x.n.includes(t) || x.compact.includes(t)));

    count.textContent = !tokens.length || !matches.length ? "" :
      matches.length === 1 ? T.stay.resultsOne : fill(T.stay.resultsMany, { count: matches.length });

    if (!matches.length) {
      return list.replaceChildren(h("li", { class: "no-match" },
        h("p", null, T.stay.noMatch),
        CFG.features.contacts && h("a", { class: "btn btn-outline", href: "#contacts" },
          icon("phone"), T.stay.noMatchAction)));
    }

    list.replaceChildren(...matches.map(({ r }) =>
      h("li", { class: "stay-row" },
        h("span", { class: "stay-sno" }, r.sno),
        h("div", null,
          h("div", { class: "stay-name" }, r.name),
          r.hotel && h("div", { class: "stay-hotel" }, r.hotel),
          r.note && h("div", { class: "stay-note" }, r.note)),
        h("div", { class: "room" }, h("small", null, T.stay.room), h("strong", null, r.room)))
    ));
  }

  /* ---------- Venues ---------- */

  function renderVenues() {
    const body = $("venues-body");
    const table = model.locations;
    if (!table.ok) return body.replaceChildren(h("p", { class: "message" }, T.status.dataUpdating));
    if (!table.rows.length) return body.replaceChildren(h("p", { class: "message" }, T.venues.empty));
    body.replaceChildren(...table.rows.map((loc) => {
      const url = safeUrl(loc.mapLink);
      return h("article", { class: "card" },
        h("h3", null, loc.name),
        loc.address && h("p", null, loc.address),
        loc.note && h("p", null, loc.note),
        url && h("div", { class: "actions" },
          h("a", { class: "btn", href: url, target: "_blank", rel: "noopener" },
            icon("navigate"), T.venues.navigate)));
    }));
  }

  /* ---------- Gallery ---------- */

  function renderGallery() {
    const body = $("gallery-body");
    const { galleryAlbum, galleryUpload } = CFG.links;
    if (!galleryAlbum && !galleryUpload) {
      return body.replaceChildren(h("div", { class: "coming-soon" },
        icon("gallery"),
        h("h3", null, T.gallery.comingSoonTitle),
        h("p", null, T.gallery.comingSoonBody)));
    }
    body.replaceChildren(h("div", { class: "gallery-actions" },
      galleryAlbum && h("a", { class: "btn", href: galleryAlbum, target: "_blank", rel: "noopener" },
        icon("gallery"), T.gallery.viewAlbum),
      galleryUpload && h("a", { class: "btn btn-outline", href: galleryUpload, target: "_blank", rel: "noopener" },
        T.gallery.upload)));
  }

  /* ---------- Contacts ---------- */

  // Returns digits with country code, e.g. "919876543210".
  function intlNumber(phone) {
    const raw = String(phone).trim();
    const digits = raw.replace(/\D/g, "");
    if (raw.startsWith("+")) return digits;
    if (digits.length === 11 && digits.startsWith("0")) return CFG.whatsappCountryCode + digits.slice(1);
    if (digits.length === 10) return CFG.whatsappCountryCode + digits;
    return digits;
  }

  function renderContacts() {
    const body = $("contacts-body");
    const table = model.contacts;
    if (!table.ok) return body.replaceChildren(h("p", { class: "message" }, T.status.dataUpdating));
    if (!table.rows.length) return body.replaceChildren(h("p", { class: "message" }, T.contacts.empty));
    body.replaceChildren(...table.rows.map((c) => {
      const number = intlNumber(c.phone);
      const hasWhatsapp = !/^(n|no|false|0)$/i.test(c.whatsapp);
      return h("article", { class: "card" },
        h("h3", null, c.name),
        c.role && h("p", null, c.role),
        h("div", { class: "actions" },
          h("a", { class: "btn", href: "tel:+" + number }, icon("phone"), T.contacts.call),
          hasWhatsapp && h("a", { class: "btn btn-outline", href: fill(CFG.whatsappUrl, { number }), target: "_blank", rel: "noopener" },
            icon("whatsapp"), T.contacts.whatsapp)));
    }));
  }

  /* ---------- Rendering & routing ---------- */

  function renderAll() {
    if (!model) return;
    prepareStay();
    renderHome();
    renderProgram();
    renderStay();
    renderVenues();
    renderGallery();
    renderContacts();
    if (currentRoute() === "program") scrollProgramToNow();
  }

  function buildInnerHeaders() {
    for (const view of document.querySelectorAll(".view.inner")) {
      const route = view.dataset.route;
      const header = view.querySelector(".inner-header");
      const back = h("button", { class: "back-btn", type: "button", "aria-label": T.back, onclick: goBack }, icon("back"));
      const title = h("h2", { tabindex: "-1" }, T.titles[route]);
      header.replaceChildren(back, title);
      header.insertAdjacentHTML("beforeend", SPRIG);
    }
  }

  function goBack() {
    if (navigatedInApp) history.back();
    else location.hash = "";
  }

  function currentRoute() {
    return location.hash.replace(/^#\/?/, "");
  }

  function showRoute() {
    const route = currentRoute();
    let found = false;
    for (const view of document.querySelectorAll(".view")) {
      const match = view.dataset.route === route;
      view.hidden = !match;
      if (match) found = true;
    }
    if (!found) $("view-home").hidden = false;
    window.scrollTo(0, 0);
    if (route && found) {
      const title = document.querySelector('[data-route="' + route + '"] h2');
      if (title) title.focus({ preventScroll: true });
    }
    if (route === "program" && model) scrollProgramToNow();
  }

  /* ---------- Status & install hint ---------- */

  let statusTimer = null;

  function showStatus(text, hideAfterMs) {
    const bar = $("status");
    bar.textContent = text;
    bar.hidden = false;
    clearTimeout(statusTimer);
    if (hideAfterMs) statusTimer = setTimeout(hideStatus, hideAfterMs);
  }

  function hideStatus() {
    $("status").hidden = true;
  }

  function setupInstallHint() {
    if (!CFG.features.installHint || storageGet(HINT_KEY)) return;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return;
    const box = $("install-hint");

    function show(message, action) {
      const close = h("button", { class: "close", type: "button", "aria-label": T.install.dismiss, onclick: dismiss }, "×");
      box.replaceChildren(h("p", null, message), action, close);
      box.hidden = false;
    }
    function dismiss() {
      box.hidden = true;
      storageSet(HINT_KEY, "1");
    }

    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      setTimeout(() => show(T.install.ios, null), 4000);
      return;
    }
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      const add = h("button", {
        class: "btn", type: "button",
        onclick: async () => {
          event.prompt();
          await event.userChoice;
          dismiss();
        },
      }, T.install.androidButton);
      show(T.install.android, add);
    });
  }

  /* ---------- Start ---------- */

  function start() {
    applyTheme();
    document.title = T.status.loading;
    buildInnerHeaders();
    $("hero-photo").src = CFG.images.hero;

    window.addEventListener("hashchange", () => {
      navigatedInApp = true;
      showRoute();
    });
    showRoute();

    if (loadCached()) renderAll();
    else showStatus(T.status.loading);
    refresh();

    $("stay-search").addEventListener("input", () => model && renderStay());

    // Keep "days to go" and "happening now" current while the app stays open.
    setInterval(() => {
      if (!model) return;
      renderHome();
      renderProgram();
    }, 60000);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetch > REFRESH_AFTER_MS) refresh();
    });

    setupInstallHint();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }

  start();
})();
