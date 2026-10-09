// Black Falcon 247 Taxi service worker — app-shell caching + offline fallback
const CACHE = "blackfalcon-v1";
const PRECACHE = [
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (Supabase, Google) pass through
  if (url.pathname.startsWith("/api/")) return; // never cache API calls

  // Page navigations: network-first, fall back to a friendly offline page
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/offline.html").then((r) => r || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // Static assets: cache-first (hashed build files, icons, fonts, styles)
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|svg|ico|woff2?|css|js|json|webmanifest)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        });
      })
    );
  }
});
