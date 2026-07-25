/* Service Worker — FinControl AI (rede primeiro, cache como reserva offline) */
const CACHE = "fincontrol-v9";
const ASSETS = [
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/bg.js",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/store.js",
  "./js/forecast.js",
  "./js/app.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Estratégia "rede primeiro": sempre busca a versão mais nova quando online,
// e usa o cache só como reserva quando está offline. Assim as atualizações
// aparecem na hora, sem ficar preso numa versão antiga.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Só cuida dos arquivos do próprio app (ignora Supabase/CDN externo).
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
