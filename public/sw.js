// frody.body — service worker
// Estrategia: network-first con fallback a cache para todo lo mismo-origen.
//   • Online  → siempre sirve lo más reciente (no hay código viejo pegado).
//   • Offline → sirve el app-shell cacheado; los DATOS offline los maneja
//     la persistencia de Firestore, no este SW.
// Las peticiones a Firebase / Google / fuentes / CDN (otro origen) pasan
// directo a la red y NO se interceptan.

const CACHE = "frodybody-v8";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./ui.js",
  "./reminders.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // deja pasar Firebase/CDN/fuentes

  // cache:"no-store" → network-first de verdad: nunca sirve JS/CSS viejos desde la
  // HTTP cache del navegador; el fallback offline usa nuestra Cache API igual.
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))
      )
  );
});

// al tocar una notificación de recordatorio: enfoca la app o ábrela
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
