/* C7NTAX Service Worker — PWA shell caching + notifications */

const CACHE_NAME = "C7NTAX-v5";
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
 * This worker only speaks for its own origin.
 *
 * It briefly spoke for everyone's, and the symptom was worth remembering: a page
 * it controls fetched the Outlook add-in's taskpane from the API's origin, that
 * deployment had the add-in switched off, and the answering 404 was cached by
 * URL alone. Switching the add-in back on changed nothing in that browser, because
 * the cache-first branch replayed the 404 — a live feature looked broken by a cached
 * error. `http://127.0.0.1:4000/addin/taskpane.html` is not this worker's business,
 * so it now says so.
 */
function isForeignOrigin(url) {
  return new URL(url).origin !== self.location.origin;
}

/**
 * A response is only ever stored if it succeeded.
 *
 * Caching an error is how a transient failure becomes permanent: the 404 above
 * could not be displaced by any number of successful requests afterwards.
 */
function cacheable(response) {
  return response.ok && response.type !== "opaqueredirect";
}

/**
 * The dev-server and API guards below are deliberately after the origin check —
 * a cross-origin request is never ours to reason about, whatever its path.
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
      // A new cache name retires the old bucket, which is what removes API responses
      // cached by an earlier version of this worker — and the cross-origin ones.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Another origin's server, including the API: not ours to cache or answer.
  if (isForeignOrigin(req.url)) return;
  // Dev server files (and the app itself in development): straight to the network
  if (isDevServerRequest(req.url)) return;
  // API calls: the network, and nothing else. No cache read, no cache write.
  if (new URL(req.url).pathname.startsWith("/api/")) return;
  // The Outlook add-in: the taskpane, the generated manifest and the installer download. It is
  // served by the API, so the same rule applies — and a downloaded installer that came back out
  // of a cache would be a rebuilt installer nobody ever receives.
  if (new URL(req.url).pathname.startsWith("/addin/")) return;
  // Navigations: network-first, so a reload always picks up the current app and
  // the cached copy only serves an offline start
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { if (cacheable(res)) { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, clone)); } return res; })
        .catch(() => caches.match(req))
    );
    return;
  }
  // Static assets: cache-first, but a stored copy is only ever a success
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (cacheable(res)) { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, clone)); }
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
