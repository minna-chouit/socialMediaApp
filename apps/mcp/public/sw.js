// Cadence service worker: shows reminder notifications and opens the app when one is tapped (FR-14).
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Cadence', body: '', url: '/' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : clients.openWindow(event.notification.data.url);
    }),
  );
});
