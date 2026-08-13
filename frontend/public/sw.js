/* DukAI Merchant Station service worker — cache shell + show push/local alerts. */

const CACHE = "dukai-station-v5";
const PRECACHE = [
  "/",
  "/m",
  "/r/home",
  "/r/login",
  "/r/install",
  "/station",
  "/install",
  "/manifest.webmanifest",
  "/rider-manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Network-first for app routes; cache fallback for shell.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/sanctum/") ||
    url.pathname.startsWith("/auth/")
  ) {
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && (url.pathname === "/m" || url.pathname.startsWith("/station") || url.pathname.startsWith("/r"))) {
          void caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (url.pathname.startsWith("/m") || url.pathname.startsWith("/station")) {
          const shell = await caches.match("/m");
          if (shell) return shell;
        }
        if (url.pathname.startsWith("/r")) {
          const shell = await caches.match("/r/home");
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});

self.addEventListener("push", (event) => {
  let title = "DukAI Merchant";
  let body = "You have a new update.";
  try {
    const data = event.data ? event.data.json() : null;
    if (data?.title) title = data.title;
    if (data?.body) body = data.body;
  } catch {
    if (event.data) body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: "/m/orders" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/m/orders";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          void client.focus();
          if ("navigate" in client) void client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
