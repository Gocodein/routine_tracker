// Service Worker for AI Engineer OS.
//
// Responsibilities:
//   1. Offline app shell — precache all static assets so the app fully works offline
//   2. Runtime caching   — stale-while-revalidate for same-origin, cache-fallback for CDNs
//   3. Notifications     — message-based, Web Push, and OFFLINE reminders driven by an
//      IndexedDB copy of the reminder schedule. The SW checks for due/missed reminders
//      every time it wakes up (fetch, periodicsync, sync, message), so reminders fire
//      even when the tab is closed or the device is offline.

const VERSION = "v2.0.1";
const SHELL_CACHE = `ai-os-shell-${VERSION}`;
const RUNTIME_CACHE = `ai-os-runtime-${VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/notifications.js",
  "/firebase-sync.js",
  "/firebase-config.js",
  "/emailjs-config.js",
  "/manifest.webmanifest",
  "/assets/ai-os-mark.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png"
];

// ---------------------------------------------------------------------------
// IndexedDB helpers (self-contained; shared DB with the main thread)
// ---------------------------------------------------------------------------

const DB_NAME = "ai-os-db";
const DB_VERSION = 1;
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Install / Activate — precache the app shell
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove caches from older versions
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("ai-os-") && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      // Check reminders on every SW wake-up
      await checkDueReminders();
    })()
  );
});

// ---------------------------------------------------------------------------
// Fetch — offline-first strategies
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Opportunistic reminder check whenever the SW wakes up (throttled inside)
  event.waitUntil(checkDueReminders().catch(() => {}));

  // Navigations: network-first, fall back to cached shell for offline access
  // (also falls back on 5xx gateway errors from proxies/CDNs)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.status >= 500) {
            const cached = await caches.match("/index.html");
            if (cached) return cached;
            return response;
          }
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (CDN SDKs like Firebase/EmailJS): network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ---------------------------------------------------------------------------
// Offline reminder engine — reads the schedule mirror from IndexedDB
// ---------------------------------------------------------------------------

const FIRE_WINDOW = 3;     // minutes — fire "live" if within this window
const CATCHUP_WINDOW = 60; // minutes — fire as "missed" if within this window
const CHECK_THROTTLE_MS = 30 * 1000;

let lastCheckAt = 0;

function todayKey() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

async function checkDueReminders() {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_THROTTLE_MS) return;
  lastCheckAt = now;

  // Only fire from the SW when permission is granted
  if (self.Notification && Notification.permission !== "granted") return;

  const config = await idbGet("notifConfig").catch(() => null);
  if (!config || !config.swEnabled || !Array.isArray(config.schedule)) return;

  const today = todayKey();
  let fired = (await idbGet("firedToday").catch(() => null)) || {};
  if (fired._date !== today) {
    fired = { _date: today };
  }

  const currentMin = nowMinutes();
  let changed = false;

  for (const item of config.schedule) {
    if (!item || !item.enabled || !item.time) continue;

    const key = `${today}_${item.time}`;
    if (fired[key]) continue;

    const diff = currentMin - timeToMinutes(item.time);
    if (diff < 0) continue; // future

    fired[key] = true;
    changed = true;

    if (diff <= FIRE_WINDOW) {
      await showReminder(item, false);
    } else if (diff <= CATCHUP_WINDOW) {
      await showReminder(item, true);
    }
    // Older than the catch-up window: mark silently so it never re-fires
  }

  if (changed) {
    await idbSet("firedToday", fired).catch(() => {});
    // Let any open tabs know so the UI log stays in sync
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((client) => client.postMessage({ type: "REMINDERS_FIRED_IN_SW" }));
  }
}

function showReminder(item, isCatchUp) {
  const priority = item.priority || "normal";
  return self.registration.showNotification(
    isCatchUp ? `Missed: ${item.title}` : item.title,
    {
      body: item.message || "",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: "ai-os-" + String(item.title).toLowerCase().replace(/\s+/g, "-"),
      renotify: true,
      requireInteraction: priority === "high" && !isCatchUp,
      vibrate: priority === "high" ? [200, 100, 200] : [100],
      data: {
        section: "dashboard",
        url: self.registration.scope
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Message-based notifications and schedule sync (from main thread)
// ---------------------------------------------------------------------------

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "SHOW_NOTIFICATION") {
    self.registration.showNotification(data.title || "AI Engineer OS", {
      body: data.body || "",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: data.tag || "ai-os-reminder",
      renotify: true,
      requireInteraction: data.priority === "high",
      vibrate: data.priority === "high" ? [200, 100, 200] : [100],
      data: {
        section: data.section || "dashboard",
        url: self.registration.scope
      }
    });
    return;
  }

  if (data.type === "SYNC_SCHEDULE") {
    event.waitUntil(
      Promise.all([
        idbSet("notifConfig", {
          swEnabled: !!data.swEnabled,
          schedule: Array.isArray(data.schedule) ? data.schedule : []
        }),
        data.firedToday ? idbSet("firedToday", data.firedToday) : Promise.resolve()
      ]).catch(() => {})
    );
    return;
  }

  if (data.type === "CHECK_REMINDERS") {
    lastCheckAt = 0; // bypass throttle for explicit checks
    event.waitUntil(checkDueReminders());
  }
});

// ---------------------------------------------------------------------------
// Web Push events (for future server-side push integration)
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let payload = { title: "AI Engineer OS", body: "Time to check in!" };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body || "",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: payload.tag || "ai-os-push",
      renotify: true,
      requireInteraction: payload.priority === "high",
      vibrate: payload.priority === "high" ? [200, 100, 200] : [100],
      data: {
        section: payload.section || "dashboard",
        url: payload.url || self.registration.scope
      }
    })
  );
});

// ---------------------------------------------------------------------------
// Notification click — focus/open the app
// ---------------------------------------------------------------------------

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const section = event.notification.data?.section || "dashboard";
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("index.html") || client.url.endsWith("/")) {
          client.postMessage({ type: "NAVIGATE_SECTION", section });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ---------------------------------------------------------------------------
// Periodic Background Sync — the offline reminder heartbeat
// ---------------------------------------------------------------------------

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "ai-os-checkin") {
    lastCheckAt = 0;
    event.waitUntil(checkDueReminders());
  }
});

// One-off Background Sync — fires when connectivity returns
self.addEventListener("sync", (event) => {
  if (event.tag === "ai-os-reminder-sync") {
    lastCheckAt = 0;
    event.waitUntil(checkDueReminders());
  }
});
