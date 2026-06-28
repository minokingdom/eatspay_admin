const CACHE_NAME = 'eatspay-pwa-v70-nav-icon-hover-force-fix';
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/app.js',
  '/logo.png',
  '/Asset 1@2x.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }

  if (requestUrl.pathname === '/js/app.js' || requestUrl.pathname === '/css/style.css' || requestUrl.pathname === '/sw.js') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (!response || response.status !== 200 || response.type !== 'basic') return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});

function parsePayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch (_) {
    return { notification: { body: event.data.text() } };
  }
}

function buildRouteUrl(data = {}) {
  const url = new URL('/', self.location.origin);
  const targetScreen = data.targetScreen || data.screen || data.route || data.target || (data.talkChatId || data.chatId ? 'talk-chat' : data.talkPostId || data.postId ? 'talk-detail' : '');
  if (targetScreen) url.searchParams.set('pushTarget', targetScreen);
  if (data.talkChatId || data.chatId) url.searchParams.set('talkChatId', data.talkChatId || data.chatId);
  if (data.talkPostId || data.postId) url.searchParams.set('talkPostId', data.talkPostId || data.postId);
  return url.href;
}

self.addEventListener('push', event => {
  const payload = parsePayload(event);
  const notification = payload.notification || payload;
  const data = {
    ...(payload.data || {}),
    ...(notification.data || {})
  };
  const title = notification.title || data.title || 'eats PAY';
  const threadId = data.notificationThreadId
    || (data.talkChatId || data.chatId
      ? `eatspay-talk-chat-${data.talkChatId || data.chatId}`
      : (data.targetScreen || data.source ? `eatspay-${data.targetScreen || data.source}` : 'eatspay-general'));
  const unreadCount = Number(data.unreadCount || 0);
  const options = {
    body: notification.body || data.body || '새 알림이 있습니다.',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: threadId,
    renotify: true,
    badgeCount: Number.isFinite(unreadCount) && unreadCount > 0 ? unreadCount : undefined,
    data
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification?.data || {};
  const targetUrl = buildRouteUrl(data);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({ type: 'EATSPAY_PUSH_CLICK', data });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
