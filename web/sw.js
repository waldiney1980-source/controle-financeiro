/* Service Worker — FinControl (cache primeiro, atualização em segundo plano) */
const CACHE = "fincontrol-v64";
const ASSETS = [
  "./index.html",
  "./css/app.css",
  "./js/config.js",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/store.js",
  "./js/bills.js",
  "./js/fatura.js",
  "./js/migrar.js",
  "./js/ui.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Estratégia "cache primeiro, atualiza atrás": o app abre na hora com o que
// já está guardado e a versão nova é buscada em segundo plano, valendo na
// abertura seguinte.
//
// Antes era "rede primeiro", e toda abertura ficava esperando o servidor
// responder — arquivo por arquivo, sem deixar o navegador reaproveitar nada.
// Quando a rota até o GitHub Pages engasga, e ela engasga, o app não abria de
// jeito nenhum, mesmo tendo tudo guardado no aparelho.
//
// Ficar preso numa versão velha não é risco: o `conferirVersao` do ui.js
// pergunta ao servidor qual é a versão publicada (com carimbo de tempo na
// URL, então sempre pela rede) e, sendo mais nova, limpa o cache e recarrega.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Só cuida dos arquivos do próprio app (ignora Supabase/CDN externo).
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // A checagem de versão pede "index.html?ts=<agora>", um endereço diferente
  // a cada abertura. Guardar isso encheria o cache de lixo, e ela precisa
  // mesmo é da resposta do servidor.
  if (url.searchParams.has("ts")) return;

  // O GitHub Pages manda o HTML com max-age=600. Pedindo no-cache, quem
  // revalida com o servidor é esta busca de fundo, não a abertura do app.
  const buscar = () => fetch(new Request(e.request, { cache: "no-cache" }))
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    });

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) {
        buscar().catch(() => {});                // atualiza para a próxima vez
        return hit;
      }
      return buscar().catch(() => caches.match("./index.html"));
    })
  );
});
