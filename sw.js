// 오프라인 실행: 앱 파일을 휴대폰에 저장해 두고, 온라인이면 항상 새 버전으로 실행
const CACHE = 'hyojeong-budget-v8';
const ASSETS = [
  './', './index.html', './css/app.css', './js/calc.js', './js/store.js', './js/app.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

// Firebase 라이브러리 (버전이 주소에 들어 있어 내용이 바뀌지 않음)
const SDK_HOST = 'https://www.gstatic.com';
const SDK = ['app', 'auth', 'firestore'].map(n => `${SDK_HOST}/firebasejs/10.14.1/firebase-${n}-compat.js`);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ASSETS);
    await Promise.all(SDK.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 인터넷이 되면 항상 최신 파일을 먼저 받고(3초 넘게 걸리면 저장본), 안 되면 저장해 둔 파일로 실행
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.url.startsWith(SDK_HOST + '/firebasejs/')) {   // 라이브러리: 저장본 우선
    e.respondWith(caches.open(CACHE).then(async cache => (await cache.match(req)) || fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })));
    return;
  }
  if (new URL(req.url).origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cachedP = cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise(r => setTimeout(r, 3000)).then(() => cachedP);
    try {
      const res = await Promise.race([fresh, timeout]);
      return res || await fresh;
    } catch (err) {
      return (await cachedP) || Response.error();
    }
  }));
});
