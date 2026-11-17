/* iTools service worker.
 * Шаблон: при сборке плагин scripts/sw-plugin.mjs подставляет список файлов и версию.
 * Стратегии:
 *  - навигация: сначала сеть (3 с), при отсутствии сети — index.html из кэша;
 *  - статические файлы приложения: сначала кэш;
 *  - изображения из CDN ВКонтакте: stale-while-revalidate с ограничением размера;
 *  - api.vk.com / id.vk.com / oauth.vk.com — никогда не перехватываются и не кэшируются.
 */
const PRECACHE_URLS = self.__ITOOLS_PRECACHE__;
const VERSION = '__ITOOLS_VERSION__';
const APP_CACHE = 'itools-app-' + VERSION;
const IMG_CACHE = 'itools-img-v1';
const IMG_LIMIT = 120;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((u) => new URL(u, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('itools-app-') && k !== APP_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isVkApiHost(host) {
  return /(^|\.)api\.vk\.(com|ru)$/.test(host) || /(^|\.)id\.vk\.(com|ru)$/.test(host) || /(^|\.)oauth\.vk\.(com|ru)$/.test(host);
}

function isVkImageHost(host) {
  return /(^|\.)(userapi\.com|vk\.me|vkuserphoto\.ru|vkuser\.net|mycdn\.me|vk-cdn\.net)$/.test(host);
}

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (response && response.ok) cache.put(new URL('./', self.registration.scope).href, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(new URL('./', self.registration.scope).href)) ||
      (await cache.match(new URL('./index.html', self.registration.scope).href)) ||
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidateImage(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).then(() => trimCache(IMG_CACHE, IMG_LIMIT));
      }
      return response;
    })
    .catch(() => cached || Response.error());
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isVkApiHost(url.hostname)) return;

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.destination === 'image' && isVkImageHost(url.hostname)) {
    event.respondWith(staleWhileRevalidateImage(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'itools:version' && event.source) event.source.postMessage({ type: 'itools:version', version: VERSION });
});
