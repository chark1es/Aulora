/*
 * Aulora Web Push service worker.
 *
 * The server sends a content-free VAPID push (payload encryption needs ECDH,
 * which the Convex runtime does not expose), so this worker shows a
 * device-computed, content-free notification and opens the app on click. If a
 * payload is ever present it is treated as opaque metadata only.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function notificationFromEvent(event) {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title.length > 0 ? data.title : "Aulora";
  const body = typeof data.body === "string" && data.body.length > 0 ? data.body : "New activity";
  const url = typeof data.url === "string" && data.url.length > 0 ? data.url : "/";
  return {
    title,
    options: {
      body,
      tag: typeof data.tag === "string" ? data.tag : "aulora-message",
      data: { url },
    },
  };
}

self.addEventListener("push", (event) => {
  const { title, options } = notificationFromEvent(event);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })(),
  );
});
