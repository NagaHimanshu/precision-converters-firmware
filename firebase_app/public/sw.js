/* Service worker: lets the site open without internet after the first visit.
   Strategy: try the network first (so edits show up), fall back to the saved
   copy when offline or the network is too slow. Sheet data is cached by app.js. */

const CACHE = "site-v2";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "site-config.js",
  "app.js",
  "manifest.webmanifest",
  "assets/icons/icon-192.png",
];
const NETWORK_TIMEOUT_MS = 4000;
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () =>
      caches.match(request, { ignoreSearch: request.mode === "navigate" }).then((hit) => hit || caches.match("index.html"));

    const timer = setTimeout(() => {
      fromCache().then((hit) => {
        if (hit && !settled) { settled = true; resolve(hit); }
      });
    }, NETWORK_TIMEOUT_MS);

    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        if (response && (response.ok || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        if (!settled) { settled = true; resolve(response); }
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((hit) => {
          if (!settled) { settled = true; resolve(hit || Response.error()); }
        });
      });
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return; // e.g. Google Sheet: handled by app.js
  event.respondWith(networkFirst(request));
});
