// sw.js — service worker for GTO Duel
//
// Handles the Web Push 'push' event by rendering a notification, and the
// 'notificationclick' event by focusing or opening the game tab.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Your turn", body: "Your opponent just submitted. It's your move." };
  try {
    if (event.data) {
      const text = event.data.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.title) payload.title = parsed.title;
        if (parsed.body) payload.body = parsed.body;
        if (parsed.url) payload.url = parsed.url;
      }
    }
  } catch (_) {
    // Payload was empty or not JSON — use defaults.
  }
  const options = {
    body: payload.body,
    tag: "gto-duel-turn",
    renotify: true,
    icon: "./icons/icon-192.svg",
    badge: "./icons/icon-192.svg",
    data: { url: payload.url || "./" },
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            try {
              client.navigate(new URL(targetUrl, self.location.href).toString());
            } catch (_) {}
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(new URL(targetUrl, self.location.href).toString());
      }
    })
  );
});
