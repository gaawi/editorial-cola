// El service worker de la app: solo para los avisos (notificaciones push).
// No guarda nada en caché: la app siempre lee lo último del servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Aprobar', {
    body: d.texto || '',
    icon: '/iconos/icono-192.png',
    badge: '/iconos/icono-192.png',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    // Si es de fuera (el post en Instagram), se abre; si es de la app, se
    // reutiliza la ventana abierta.
    if (/^https?:\/\//.test(url)) return self.clients.openWindow(url);
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (abiertas.length) { await abiertas[0].focus(); return abiertas[0].navigate ? abiertas[0].navigate(url) : null; }
    return self.clients.openWindow(url);
  })());
});
