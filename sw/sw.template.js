/*
 * 가계부 서비스 워커 (빌드할 때 vite.config.ts의 플러그인이 아래 두 상수의 자리표시 값을 채워 dist/sw.js로 만든다)
 *
 * - 앱 파일(화면·스크립트·스타일·아이콘)은 설치할 때 한꺼번에 저장해 두고, 이후에는 저장된 것을 먼저 쓴다.
 *   그래서 인터넷이 없어도 열린다. 가계부 데이터는 이 파일과 무관하게 기기의 IndexedDB에 있다.
 * - 새 버전이 배포되면 백그라운드에서 받아 두기만 하고, 사용자가 화면의 "새로고침"을 누를 때 바꾼다
 *   (쓰는 도중에 화면이 갑자기 바뀌지 않도록 skipWaiting을 자동으로 부르지 않는다).
 * - 같은 주소(이 사이트) 요청만 다룬다. 구글 로그인·드라이브 같은 다른 주소 요청은 건드리지 않는다.
 */
const VERSION = '__VERSION__';
const CACHE = 'gagyeboo-app-' + VERSION;
const FONT_CACHE = 'gagyeboo-fonts'; // 글꼴 파일은 이름에 내용 해시가 있어 버전과 상관없이 계속 쓴다
const PRECACHE = __PRECACHE__;
const SCOPE = self.registration.scope;
const INDEX = new URL('index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(new URL(p, SCOPE).href, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('gagyeboo-app-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

async function navigate(request) {
  const cache = await caches.open(CACHE);
  const hit = (await cache.match(request, { ignoreSearch: true })) || (await cache.match(INDEX));
  if (hit) return hit;
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(SCOPE)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  if (/\.woff2?$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }
  event.respondWith(cacheFirst(request, CACHE));
});
