// Service Worker for AI Engineer OS notifications.
// Receives messages from the main thread and shows OS-level notifications
// even when the app tab is in the background or minimised.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "SHOW_NOTIFICATION") return;

  self.registration.showNotification(data.title || "AI Engineer OS", {
    body: data.body || "",
    icon: "assets/ai-os-mark.svg",
    badge: "assets/ai-os-mark.svg",
    tag: data.tag || "ai-os-reminder",
    renotify: true,
    requireInteraction: false,
    data: { section: data.section || "dashboard" }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const section = event.notification.data?.section || "dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("index.html") || client.url.endsWith("/")) {
          client.postMessage({ type: "NAVIGATE_SECTION", section });
          return client.focus();
        }
      }
      return self.clients.openWindow("/");
    })
  );
});
