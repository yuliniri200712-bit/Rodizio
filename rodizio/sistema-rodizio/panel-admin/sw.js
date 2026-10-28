﻿/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
// Rodizio Admin â€” service worker: cachea el cascarÃ³n de la app para que
// abra al instante y quede instalable. Las peticiones a firebaseio.com
// (RTDB) nunca se cachean â€” deben ir siempre en vivo. Las llamadas de
// autenticaciÃ³n son POST y el fetch handler ya las deja pasar de largo
// (solo intercepta GET), asÃ­ que no hace falta excluirlas aparte.
const CACHE = "rodizio-admin-v40";
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
  "./dashboard.js",
  "./reporte-excel.js",
  "./dashboard.css",
  "../shared/marca.css",
  "../shared/theme.css",
  "../shared/ui.css",
  "../shared/firebase.js",
  "../shared/firebase-app.js",
  "../shared/util.js",
  "../shared/roles.js",
  "../shared/ui.js",
  "../shared/pwa.js",
  "../shared/auth.js",
  "../shared/pwa.css",
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
