/* Service Worker — FinControl (rede primeiro, cache como reserva offline) */
const CACHE = "fincontrol-v33";
const ASSETS = [
  "./index.html",
  "./css/app.css",
  "./js/config.js",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/store.js",
  "./js/bills.js",
  "./js/fatura.js",
  "./js/ui.js",
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

  // "Rede primeiro" não bastava: o GitHub Pages manda o HTML com
  // max-age=600, então o `fetch` era atendido pelo cache HTTP do navegador
  // e a versão nova só aparecia dez minutos depois. Pedindo no-cache, o
  // navegador é obrigado a revalidar com o servidor a cada carga.
  const req = e.request.mode === "navigate"
    ? new Request(url.href, { cache: "reload", credentials: "same-origin" })
    : new Request(e.request, { cache: "no-cache" });

  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
