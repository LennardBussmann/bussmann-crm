// Minimaler Service Worker, damit sich das CRM als App installieren lässt. Es wird nichts zwischengespeichert.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
