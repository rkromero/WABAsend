/* Service worker — hace la app instalable y que abra rápido / sin señal.
   Nunca cachea la API: los mensajes siempre vienen frescos del servidor. */
const CACHE = 'ventas-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Navegación: red primero, si no hay señal se abre la app cacheada
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put('/', res.clone())); return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Assets con hash de Vite: cache primero (no cambian nunca)
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});

// Push del servidor: mensaje nuevo de un cliente (llega aunque la app esté cerrada)
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() }; }
  const title = data.title || 'Mensaje nuevo';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'mensaje',
    renotify: true,
    vibrate: [120, 60, 120],
    timestamp: Date.now(),
    data: { url: data.url || '/' },
  };
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Si la app está abierta y en pantalla, ya suena adentro: no duplicar (como WhatsApp)
      const visible = list.some((c) => c.visibilityState === 'visible' && c.focused);
      if (visible) return;
      return self.registration.showNotification(title, options);
    })
  );
});

// Tocar una notificación abre / enfoca la app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        return c.focus().then((fc) => (fc || c).navigate?.(target));
      }
      return self.clients.openWindow(target);
    })
  );
});
