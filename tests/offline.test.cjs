const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dist = path.resolve(__dirname, '../rangelab/dist');
const read = name => fs.readFileSync(path.join(dist, name), 'utf8');

test('an installation on a GitHub Pages subpath caches the entire offline app', async () => {
  const scope = 'https://example.github.io/RangeLab/';
  const listeners = new Map();
  const cache = new Map();
  const storage = {
    async open() {
      return {
        async addAll(requests) {
          for (const request of requests) {
            assert.ok(request.url.startsWith(scope));
            const name = request.url.slice(scope.length);
            cache.set(request.url, read(name));
          }
        },
        async match(key) { return cache.get(key); }
      };
    }
  };
  vm.runInNewContext(read('sw.js'), {
    URL, Request, caches: storage, self: {
      registration: { scope },
      addEventListener(name, callback) { listeners.set(name, callback); }
    }
  });
  let installed;
  listeners.get('install')({waitUntil(promise) { installed = promise; }});
  await installed;
  const html = read('index.html');
  const entries = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(match => match[1]);
  for (const name of entries) assert.ok(cache.has(scope + name), name + ' is missing from the offline release');
  // Browsers persist the installed service worker separately from its CacheStorage.
  for (const name of fs.readdirSync(dist).filter(file => file !== 'sw.js')) {
    assert.ok(cache.has(scope + name), name + ' will be unavailable offline');
  }
  let response;
  listeners.get('fetch')({
    request: {method: 'GET', url: scope, mode: 'navigate'},
    respondWith(promise) {response = promise;}
  });
  assert.equal(await response, html);
});

test('standalone manifest uses project-relative URLs and correctly sized icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(dist, icon.src));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(icon.sizes, png.readUInt32BE(16) + 'x' + png.readUInt32BE(20));
  }
});
