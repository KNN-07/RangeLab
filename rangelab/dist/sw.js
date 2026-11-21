const RELEASE = '__RANGELAB_RELEASE__';
// GitHub Pages projects share an origin. Each installation owns only its scoped caches.
const cachePrefix = 'rangelab:' + self.registration.scope + ':';
const cacheName = cachePrefix + RELEASE;
const fileNames = [
  'index.html', 'style.css', 'app.js', 'engine.js', 'gpu.js', 'pwa.js', 'analyze.js',
  'postflop.js', 'postflop-worker.js', 'postflop-tree.js', 'line-explorer.js', 'reports.js', 'tournament.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'
];
const scope = new URL(self.registration.scope);
const files = fileNames.map(name => new URL(name, scope).href);
const knownFiles = new Set(files);
const entry = new URL('index.html', scope).href;
const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(scope.hostname);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(files.map(url => new Request(url, { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.origin + url.pathname;
  const isEntry = request.mode === 'navigate' && (path === scope.href || path === entry);
  const key = isEntry ? entry : path;
  if (!knownFiles.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    // Keep local edits visible during development. Production uses one coherent
    // precached release until the next service worker activates.
    if (localPreview) {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(key, response.clone());
        return response;
      } catch { /* A stopped local server still supports offline launches. */ }
    }
    return (await cache.match(key)) || fetch(request);
  })());
});
