/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
// Rodizio — service worker: cachea el cascarón de la app so it opens instantly
// and keeps working with no signal (e.g. inside the restaurant kitchen area).
const CACHE = "rodizio-v39";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "../icons/apple-touch-icon.png",
  "../icons/favicon.png",
  "../icons/icon-192.png",
  "../icons/icon-512.png",
  "../icons/icon-maskable-512.png",
  "./app.js",
  "./styles.css",
  "../shared/marca.css",
  "../shared/theme.css",
  "../shared/ui.css",
  "../shared/firebase.js",
  "../shared/util.js",
  "../shared/roles.js",
  "../shared/ui.js",
  "../shared/pwa.js",
  "../shared/auth.js",
  "../shared/pwa.css",
  "../shared/menu-loader.js",
  "../shared/firebase-app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation, falling back to the cached shell when offline.
// Cache-first for everything else (fonts, scripts) once it's been fetched once.
// Firebase requests (streaming + writes) are never cached.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.url.includes("firebaseio.com")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
