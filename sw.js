// 電波がなくても開けるようにする。一度開いたページとデータをスマホに保存しておき、
// 電波があるときは毎回最新を取り（4秒で返ってこなければ保存したものを使う）、ないときは保存したもので動く。
const CACHE = 'usjnavi-v1';
const CORE = ['./', './waits.json', './stats.json', './usj-navi.ics', './manifest.json', './icon-180.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Queue-Times や天気予報はそのまま
  if (url.pathname.endsWith('/index.html') && url.searchParams.has('t')) return; // 新しい版の確認は保存したものを返さない
  // 保存するときは ?t= や ?v= を外した住所で（ページは「./」にまとめる）
  const key = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
    net.catch(() => {}); // 電波がないときのエラーは、下で保存したものを返すので無視
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000, null));
    try {
      const res = await Promise.race([net, timeout]);
      if (res) return res;
    } catch {}
    const saved = await cache.match(key);
    if (saved) return saved;
    return net; // 保存したものもなければ、電波が戻るのを待つ
  })());
});
