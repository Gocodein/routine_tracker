// Service Worker for AI Engineer OS notifications.
// Handles three types of notifications:
//   1. Message-based — from main thread postMessage (tab open)
//   2. Push events  — from server-side Web Push API (tab closed, future)
//   3. Periodic sync — background check-ins (browser discretion)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ---------------------------------------------------------------------------
// Message-based notifications (from main thread)
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "SHOW_NOTIFICATION") return;

  self.registration.showNotification(data.title || "AI Engineer OS", {
    body: data.body || "",
    icon: "assets/ai-os-mark.svg",
    badge: "assets/ai-os-mark.svg",
    tag: data.tag || "ai-os-reminder",
    renotify: true,
    requireInteraction: data.priority === "high",
    vibrate: data.priority === "high" ? [200, 100, 200] : [100],
    data: {
      section: data.section || "dashboard",
      url: self.registration.scope
    }
  });
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
      icon: "assets/ai-os-mark.svg",
      badge: "assets/ai-os-mark.svg",
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
      // Try to focus an existing tab
      for (const client of clients) {
        if (client.url.includes("index.html") || client.url.endsWith("/")) {
          client.postMessage({ type: "NAVIGATE_SECTION", section });
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ---------------------------------------------------------------------------
// Periodic Background Sync (if available)
// ---------------------------------------------------------------------------
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "ai-os-checkin") {
    event.waitUntil(
      self.registration.showNotification("AI Engineer OS", {
        body: "Time to check in on your progress!",
        icon: "assets/ai-os-mark.svg",
        badge: "assets/ai-os-mark.svg",
        tag: "ai-os-periodic",
        data: { section: "dashboard" }
      })
    );
  }
});
