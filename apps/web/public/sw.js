/* C7NTAX Service Worker — PWA shell caching + notifications */

const CACHE_NAME = "C7NTAX-v3";
const STATIC_ASSETS = ["/", "/index.html", "/icon-192.png", "/manifest.json"];

/**
 * Vite's dev-server internals are served from memory on every request and must
 * never be cached: a cached module means the browser keeps running the code
 * from before the last edit, no matter how many times the page is reloaded.
 */
function isDevServerRequest(url) {
  const path = new URL(url).pathname;
  return path.startsWith("/src/") || path.startsWith("/@") || path.startsWith("/node_modules/");
}

/**
 * API responses are never cached.
 *
 * They used to be, keyed by URL alone — which meant a response fetched with one
 * account's cookie was served back later to whoever was using the browser, most
 * visibly after signing out or when the API was unreachable. Tickets, clients,
 * invoices and now the customer portal all went through it. A cache key of
 * "URL" cannot express "as this person", so the honest answer when the API
 * cannot be reached is a failed request and a page that says so.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      // A new cache name retires the old bucket, which is also what removes
      // any API responses cached by an earlier version of this worker.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE_NAME))
      .then((cache) => cache.keys())
      .then((requests) => Promise.all(
        requests.filter((req) => new URL(req.url).pathname.startsWith("/api/")).map((req) => caches.open(CACHE_NAME).then((c) => c.delete(req)))
      ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Dev server files (and the app itself in development): straight to the network
  if (isDevServerRequest(req.url)) return;
  // API calls: the network, and nothing else. No cache read, no cache write.
  if (new URL(req.url).pathname.startsWith("/api/")) return;
  // Navigations: network-first, so a reload always picks up the current app and
  // the cached copy only serves an offline start
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, clone)); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }
  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, clone));
      return res;
    }))
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() || { title: "C7NTAX", body: "New notification" };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/favicon.png",
      tag: data.tag || "default",
      data: data.url || "/",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) existing.focus();
      else self.clients.openWindow(url);
    })
  );
});
